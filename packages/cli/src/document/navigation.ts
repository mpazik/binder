import { extname, join } from "path";
import {
  type AncestralFieldsetChain,
  buildIncludes,
  emptyFieldset,
  type EntitySchema,
  type EntityUid,
  type Fieldset,
  type FieldsetNested,
  type Filters,
  type GraphVersion,
  type Includes,
  type KnowledgeGraph,
  type ReadonlyKnowledgeGraph,
  matchesFilters,
  mergeIncludes,
  type NamespaceEditable,
  pickByIncludes,
  type QueryParams,
  serializeFieldValue,
} from "@binder/repo";
import {
  assertDefinedPass,
  type ErrorObject,
  fail,
  isErr,
  ok,
  omit,
  type Result,
  type ResultAsync,
  resultFallback,
} from "@binder/utils";
import type { Logger } from "../log.ts";
import { sanitizeFilename } from "../utils/file.ts";
import {
  extractFieldNames,
  extractFieldValues,
  interpolatePlain,
  parseAncestralPlaceholder,
} from "../utils/interpolate-fields.ts";
import type { DatabaseCli } from "../db";
import { interpolateQueryParams } from "../utils/query.ts";
import { saveSnapshot, type SnapshotMode } from "../lib/snapshot.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import { BINDER_DIR, type ConfigPaths } from "../config.ts";
import { renderView } from "./view.ts";
import {
  findEntityInYamlList,
  renderYamlEntity,
  renderYamlList,
} from "./yaml.ts";
import { formatReferences, formatReferencesList } from "./reference.ts";
import type { FileType } from "./document.ts";
import {
  DOCUMENT_VIEW_KEY,
  VIEW_VIEW_KEY,
  type ViewEntity,
  type ViewKey,
  type Views,
} from "./view-entity.ts";
import { prependFrontmatter, renderFrontmatterString } from "./frontmatter.ts";

export type NavigationItem = {
  path: string;
  where?: Filters;
  view?: string;
  includes?: Includes;
  query?: QueryParams;
  limit?: number;
  children?: NavigationItem[];
};

const inferFileType = (item: NavigationItem): FileType => {
  if (item.path.endsWith("/")) return "directory";
  if (item.view !== undefined) return "markdown";
  return "yaml";
};

const getExtension = (fileType: FileType): string => {
  if (fileType === "markdown") return ".md";
  if (fileType === "yaml") return ".yaml";
  return "";
};

export const getPathPattern = (item: NavigationItem): string =>
  item.path + getExtension(inferFileType(item));

export type RenderResult = {
  renderedPaths: string[];
  modifiedPaths: string[];
  divergedPaths: string[];
  /** Errors from navigation items that failed to render. Successful items still contribute to renderedPaths. */
  errors: ErrorObject[];
};

const emptyRenderResult = (): RenderResult => ({
  renderedPaths: [],
  modifiedPaths: [],
  divergedPaths: [],
  errors: [],
});

const appendRenderResult = (target: RenderResult, next: RenderResult): void => {
  target.renderedPaths.push(...next.renderedPaths);
  target.modifiedPaths.push(...next.modifiedPaths);
  target.divergedPaths.push(...next.divergedPaths);
  target.errors.push(...next.errors);
};

const DEFAULT_RENDER_LIMIT = 1_000;

export type RenderContext = {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  fs: FileSystem;
  paths: ConfigPaths;
  schema: EntitySchema;
  version: GraphVersion;
  namespace: NamespaceEditable;
  views: Views;
  log: Logger;
  mode?: SnapshotMode;
};

export const CONFIG_NAVIGATION_ITEMS: NavigationItem[] = [
  {
    path: `${BINDER_DIR}/fields`,
    query: {
      filters: { type: "Field" },
    },
  },
  {
    path: `${BINDER_DIR}/types`,
    query: {
      filters: { type: "Type" },
    },
  },
  {
    path: `${BINDER_DIR}/navigation`,
    query: {
      filters: { type: "Navigation" },
    },
  },
  {
    path: `${BINDER_DIR}/views/{key}`,
    where: { type: "View" },
    view: VIEW_VIEW_KEY,
  },
];

const getParentDir = (filePath: string, fileType: FileType): string => {
  if (fileType === "directory") return filePath;
  const ext = extname(filePath);
  const withoutExt = ext ? filePath.slice(0, -ext.length) : filePath;
  return withoutExt + "/";
};

export const getNavigationFilePatterns = (
  items: NavigationItem[],
  prefix = "",
): string[] => {
  const patterns: string[] = [];
  for (const item of items) {
    const pattern = getPathPattern(item);
    const resolvedPattern = resultFallback(
      interpolatePlain(pattern, () => ok("*")),
      pattern,
    );
    patterns.push(prefix + resolvedPattern);

    if (item.children) {
      const fileType = inferFileType(item);
      const parentDir = getParentDir(resolvedPattern, fileType);
      patterns.push(
        ...getNavigationFilePatterns(item.children, prefix + parentDir),
      );
    }
  }
  return patterns;
};

export const buildNavigationTree = (
  items: FieldsetNested[],
): NavigationItem[] => {
  const childrenByParentKey = new Map<string, FieldsetNested[]>();
  for (const item of items) {
    const parentKey = item.parent as string | undefined;
    if (!parentKey) continue;
    const siblings = childrenByParentKey.get(parentKey) ?? [];
    siblings.push(item);
    childrenByParentKey.set(parentKey, siblings);
  }

  const buildTree = (item: FieldsetNested): NavigationItem => {
    const childItems = childrenByParentKey.get(item.key as string);
    const children = childItems?.map((child) => buildTree(child));

    return {
      path: item.path as string,
      where: item.where as Filters | undefined,
      view: item.view as string | undefined,
      includes: item.includes as Includes | undefined,
      query: item.query as QueryParams | undefined,
      limit: item.limit as number | undefined,
      ...(children && children.length > 0 ? { children } : {}),
    };
  };

  return items.filter((item) => !item.parent).map((root) => buildTree(root));
};

export const loadNavigation = async (
  kg: ReadonlyKnowledgeGraph,
  namespace: NamespaceEditable = "record",
): ResultAsync<NavigationItem[]> => {
  if (namespace === "config") return ok(CONFIG_NAVIGATION_ITEMS);

  const searchResult = await kg.search(
    {
      filters: { type: "Navigation" },
    },
    "config",
  );

  if (isErr(searchResult)) return searchResult;

  return ok(buildNavigationTree(searchResult.data.items));
};

export const findNavigationItemByPath = (
  items: NavigationItem[],
  path: string,
): NavigationItem | undefined => {
  for (const item of items) {
    const fileType = inferFileType(item);

    if (fileType === "directory") {
      if (!item.children) continue;

      const slashCount = (item.path.match(/\//g) || []).length;
      let slashIndex = -1;
      for (let i = 0; i < slashCount; i++) {
        slashIndex = path.indexOf("/", slashIndex + 1);
        if (slashIndex === -1) break;
      }
      if (slashIndex === -1) continue;

      const pathPrefix = path.slice(0, slashIndex + 1);
      const pathFieldsResult = extractFieldValues(item.path, pathPrefix);
      if (isErr(pathFieldsResult)) continue;

      const remainingPath = path.slice(slashIndex + 1);
      const found = findNavigationItemByPath(item.children, remainingPath);
      if (found) return found;
      continue;
    }

    const pathPattern = getPathPattern(item);
    const pathFieldsResult = extractFieldValues(pathPattern, path);
    if (isErr(pathFieldsResult)) continue;
    return item;
  }
};

/**
 * A path resolved from a navigation item's pattern. When the pattern
 * references multi-value fields at depth 0 (current entity), resolvePath
 * fans out to one entry per value, narrowing those fields on `narrowedEntity`.
 */
export type ResolvedPath = {
  path: string;
  /**
   * Entity with depth-0 multi-value fan-out fields narrowed to the single
   * value used for this path. Passed to children so `{parent.<field>}`
   * resolves to the narrowed value in paths and query filters.
   */
  narrowedEntity: Fieldset;
};

const cartesian = <T>(arrays: T[][]): T[][] => {
  if (arrays.length === 0) return [[]];
  const [first, ...rest] = arrays;
  const restProduct = cartesian(rest);
  return first!.flatMap((v) => restProduct.map((combo) => [v, ...combo]));
};

/**
 * Resolve a navigation item's path pattern against an entity, producing one
 * or more {@link ResolvedPath} entries. Multi-value fields at depth 0 trigger
 * fan-out: one entry per value (cartesian product when multiple such fields
 * appear). Each entry carries a narrowed copy of the entity where fan-out
 * fields are set to the single value used for that path.
 */
export const resolvePath = (
  schema: EntitySchema,
  navItem: NavigationItem,
  entity: Fieldset,
  parentEntities: AncestralFieldsetChain = [],
): Result<ResolvedPath[]> => {
  const pathPattern = getPathPattern(navItem);

  // Find depth-0 placeholders that reference a multi-value field with an
  // array value. Each one triggers fan-out. Multiple fields produce the
  // cartesian product of their values.
  const fanOutFields: string[] = [];
  const fanOutValues: unknown[][] = [];
  const seen = new Set<string>();
  for (const placeholder of extractFieldNames(pathPattern)) {
    const { fieldName, depth } = parseAncestralPlaceholder(placeholder);
    if (depth !== 0) continue;
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);
    const fieldDef = schema.fields[fieldName];
    if (!fieldDef?.allowMultiple) continue;
    const value = entity[fieldName];
    if (!Array.isArray(value)) continue;
    if (value.length === 0) {
      return fail("missing-path-field", "Path field is null or undefined", {
        data: { fieldName, depth: 0, pathPattern },
      });
    }
    fanOutFields.push(fieldName);
    fanOutValues.push(value);
  }

  const narrowedEntities: Fieldset[] =
    fanOutFields.length === 0
      ? [entity]
      : cartesian(fanOutValues).map((combo) => {
          const narrowed: Fieldset = { ...entity };
          for (let i = 0; i < fanOutFields.length; i++) {
            narrowed[fanOutFields[i]!] = combo[i] as Fieldset[string];
          }
          return narrowed;
        });

  const results: ResolvedPath[] = [];
  for (const narrowedEntity of narrowedEntities) {
    const entityContext = [narrowedEntity, ...parentEntities];
    const pathResult = interpolatePlain(pathPattern, (placeholder) => {
      const { fieldName, depth } = parseAncestralPlaceholder(placeholder);
      const value = entityContext[depth]?.[fieldName];

      if (value == null) {
        return fail("missing-path-field", "Path field is null or undefined", {
          data: { fieldName, depth, pathPattern },
        });
      }

      return ok(
        sanitizeFilename(serializeFieldValue(value, schema.fields[fieldName])),
      );
    });
    if (isErr(pathResult)) return pathResult;
    results.push({ path: pathResult.data, narrowedEntity });
  }
  return ok(results);
};

const getExcludedFields = (
  namespace: NamespaceEditable,
  filters: Filters | undefined,
): string[] => [
  "id",
  ...(namespace === "config" ? ["uid"] : []),
  ...(filters?.type && typeof filters.type !== "object" ? ["type"] : []),
];

export const findView = (views: Views, key: string | undefined): ViewEntity =>
  views.find((v) => v.key === key) ??
  assertDefinedPass(
    views.find((v) => v.key === DOCUMENT_VIEW_KEY),
    `DOCUMENT_VIEW_KEY "${DOCUMENT_VIEW_KEY}" in views`,
  );

type RenderContentCtx = Pick<
  RenderContext,
  "kg" | "schema" | "namespace" | "views"
>;

const renderContent = async (
  ctx: RenderContentCtx,
  item: NavigationItem,
  entity: FieldsetNested,
  parentEntities: AncestralFieldsetChain,
  fileType: FileType,
): ResultAsync<string | null> => {
  const { kg, schema, namespace, views } = ctx;

  if (fileType === "markdown") {
    const formattedEntity = await formatReferences(entity, schema, kg);
    if (isErr(formattedEntity)) return formattedEntity;

    const viewEntity = findView(views, item.view);
    const viewResult = renderView(
      schema,
      views,
      viewEntity.key as ViewKey,
      formattedEntity.data,
    );
    if (isErr(viewResult)) return viewResult;

    const preamble = viewEntity.preamble;
    if (!preamble || preamble.length === 0) return ok(viewResult.data);

    const preambleIncludes = buildIncludes(preamble.map((key) => [key]));
    if (!preambleIncludes) return ok(viewResult.data);

    const pickedEntity = pickByIncludes(formattedEntity.data, preambleIncludes);
    const frontmatter = renderFrontmatterString(pickedEntity, preamble, schema);
    if (!frontmatter) return ok(viewResult.data);

    return ok(prependFrontmatter(viewResult.data, frontmatter));
  }
  if (fileType === "yaml") {
    if (item.query) {
      const interpolatedQuery = interpolateQueryParams(schema, item.query, [
        entity,
        ...parentEntities,
      ]);
      if (isErr(interpolatedQuery)) return interpolatedQuery;

      const queryResult = await kg.search(interpolatedQuery.data, namespace);
      if (isErr(queryResult)) return queryResult;

      const formattedItems = await formatReferencesList(
        queryResult.data.items,
        schema,
        kg,
      );
      if (isErr(formattedItems)) return formattedItems;

      if (item.query.includes) {
        const items = item.query.includes.uid
          ? formattedItems.data
          : formattedItems.data.map((e) => omit(e, ["uid"]));
        return ok(renderYamlList(items, schema));
      }

      const excludedFields = getExcludedFields(namespace, item.query.filters);
      const filteredItems = formattedItems.data.map((e) =>
        omit(e, [...excludedFields, "uid"]),
      );
      return ok(renderYamlList(filteredItems, schema));
    }
    const formattedEntity = await formatReferences(entity, schema, kg);
    if (isErr(formattedEntity)) return formattedEntity;

    const excludedFields = getExcludedFields(namespace, item.where);
    const filteredEntity = omit(formattedEntity.data, excludedFields);
    return ok(renderYamlEntity(filteredEntity, schema));
  }
  return ok(null);
};

export const renderNavigationItem = async (
  ctx: RenderContext,
  item: NavigationItem,
  parentPath: string,
  parentEntities: Fieldset[],
): ResultAsync<RenderResult> => {
  const { db, fs, paths, schema, version, namespace, views, log } = ctx;
  const fileType = inferFileType(item);
  const result = emptyRenderResult();

  let entities: FieldsetNested[];

  if (item.where) {
    const interpolatedQuery = interpolateQueryParams(
      schema,
      {
        filters: item.where,
        includes: item.includes,
        pagination: { limit: item.limit ?? DEFAULT_RENDER_LIMIT },
      },
      [emptyFieldset, ...parentEntities],
    );
    if (isErr(interpolatedQuery)) return interpolatedQuery;

    if (item.view || interpolatedQuery.data.includes) {
      const viewIncludes = item.view
        ? findView(views, item.view).viewIncludes
        : undefined;
      interpolatedQuery.data.includes = mergeIncludes(
        mergeIncludes(interpolatedQuery.data.includes, viewIncludes),
        { key: true, uid: true },
      );
    }

    const searchResult = await ctx.kg.search(interpolatedQuery.data, namespace);
    if (isErr(searchResult)) return searchResult;

    if (searchResult.data.pagination.hasNext && !item.limit) {
      const pathPattern = getPathPattern(item);
      log.warn(
        `Navigation '${pathPattern}' has more results than the default render limit. Some files were not rendered. Set 'limit' on the navigation item to increase.`,
      );
    }

    entities = searchResult.data.items;
  } else {
    entities = [parentEntities[0] ?? emptyFieldset];
  }

  // Key/uid are kept in query includes for path resolution, then stripped from
  // output when the user provided includes without those fields.
  // Views control their own output so no stripping is needed.
  const fieldsToStrip =
    !item.view && item.includes
      ? (["uid", "key"] as const).filter((f) => !item.includes![f])
      : [];

  for (const entity of entities) {
    const entityUid = (entity.uid as EntityUid) ?? null;

    const resolvedPath = resolvePath(
      schema,
      item,
      entity as Fieldset,
      parentEntities,
    );
    if (isErr(resolvedPath)) {
      if (resolvedPath.error.key !== "missing-path-field") return resolvedPath;

      const entityId =
        (entity.key as string | undefined) ??
        (entity.uid as string | undefined) ??
        "<unknown>";
      const missingFieldName =
        (resolvedPath.error.data as { fieldName?: unknown } | undefined)
          ?.fieldName ?? "unknown";

      log.warn(
        `Skipping render for entity '${entityId}' in navigation '${getPathPattern(item)}': missing value for path field '${String(missingFieldName)}'.`,
      );
      continue;
    }

    for (const { path: subPath, narrowedEntity } of resolvedPath.data) {
      const filePath = join(parentPath, subPath);

      const renderEntity =
        fieldsToStrip.length > 0
          ? (omit(entity, fieldsToStrip) as FieldsetNested)
          : entity;

      const renderContentResult = await renderContent(
        ctx,
        item,
        renderEntity,
        parentEntities,
        fileType,
      );
      if (isErr(renderContentResult)) return renderContentResult;

      if (renderContentResult.data !== null) {
        const saveResult = await saveSnapshot(
          db,
          fs,
          paths,
          filePath,
          renderContentResult.data,
          version,
          entityUid,
          { mode: ctx.mode },
        );
        if (isErr(saveResult)) return saveResult;

        result.renderedPaths.push(filePath);
        if (saveResult.data === "written") {
          result.modifiedPaths.push(filePath);
        } else if (saveResult.data === "skipped-diverged") {
          result.divergedPaths.push(filePath);
        }
      }

      if (item.children) {
        const itemDir = getParentDir(filePath, fileType);
        const childParentEntities = item.where
          ? [narrowedEntity, ...parentEntities]
          : parentEntities;

        for (const child of item.children) {
          const childResult = await renderNavigationItem(
            ctx,
            child,
            itemDir,
            childParentEntities,
          );
          if (isErr(childResult)) return childResult;

          appendRenderResult(result, childResult.data);
        }
      }
    }
  }

  return ok(result);
};

export type RenderNavigationCtx = Omit<RenderContext, "schema" | "version">;

export const renderNavigation = async (
  ctx: RenderNavigationCtx,
  navigationItems: NavigationItem[],
): ResultAsync<RenderResult> => {
  const schemaResult = await ctx.kg.getSchema(ctx.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const versionResult = await ctx.kg.version();
  if (isErr(versionResult)) return versionResult;

  const renderCtx: RenderContext = {
    ...ctx,
    schema: schemaResult.data,
    version: versionResult.data,
  };

  const result = emptyRenderResult();

  for (const item of navigationItems) {
    const itemResult = await renderNavigationItem(renderCtx, item, "", []);
    if (isErr(itemResult)) {
      const pathPattern = getPathPattern(item);
      ctx.log.warn(
        `Navigation '${pathPattern}' failed to render: ${itemResult.error.message}`,
      );
      result.errors.push(itemResult.error);
      continue;
    }
    appendRenderResult(result, itemResult.data);
  }

  return ok(result);
};

export type LocationInFile = {
  filePath: string;
  line: number;
};

const isListNavItem = (item: NavigationItem): boolean =>
  item.query !== undefined;

const flattenNavigationItems = (items: NavigationItem[]): NavigationItem[] => {
  const result: NavigationItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenNavigationItems(item.children));
  }
  return result;
};

const scoreNavItem = (item: NavigationItem): number => {
  let score = 0;

  // Individual file >> list - user wants the dedicated file, not a line in a list
  if (!isListNavItem(item)) score += 100;

  // Markdown > YAML - markdown is the richer, primary representation
  if (inferFileType(item) === "markdown") score += 50;

  // Tiebreaker: simpler paths and filters are preferred.
  // When scores are equal, we assume the user wants the "default" or "canonical"
  // location rather than a special-case or highly-specific organizational path.
  // e.g., "tasks/{key}.md" is preferred over "projects/{project}/tasks/{key}.md"
  const filters = item.where ?? item.query?.filters;
  const filterCount = filters ? Object.keys(filters).length : 0;
  const pathDepth = (item.path.match(/\{/g) || []).length;

  score -= filterCount;
  score -= pathDepth;

  return score;
};

const findMatchingNavItem = (
  items: NavigationItem[],
  entity: Fieldset,
): NavigationItem | undefined => {
  let best: { item: NavigationItem; score: number } | undefined;

  for (const item of flattenNavigationItems(items)) {
    const filters = item.where ?? item.query?.filters;
    if (!filters) continue;
    if (!matchesFilters(filters, entity)) continue;

    const score = scoreNavItem(item);
    if (!best || score > best.score) best = { item, score };
  }

  return best?.item;
};

export const findEntityLocation = async (
  fs: FileSystem,
  paths: ConfigPaths,
  schema: EntitySchema,
  entity: Fieldset,
  navigation: NavigationItem[],
): ResultAsync<LocationInFile | undefined> => {
  const navItem = findMatchingNavItem(navigation, entity);
  if (!navItem) return ok(undefined);

  const resolvedPathResult = resolvePath(schema, navItem, entity, []);
  if (isErr(resolvedPathResult)) return resolvedPathResult;

  // A fan-out produces multiple paths; pick the first for "go to definition".
  const filePath = join(paths.docs, resolvedPathResult.data[0]!.path);

  if (!isListNavItem(navItem)) {
    return ok({ filePath, line: 0 });
  }

  const contentResult = await fs.readFile(filePath);
  if (isErr(contentResult)) return ok({ filePath, line: 0 });

  const entityKey = entity.key as string | undefined;
  const entityUid = entity.uid as string | undefined;

  if (!entityKey && !entityUid) return ok({ filePath, line: 0 });

  const line = findEntityInYamlList(contentResult.data, entityKey, entityUid);
  return ok({ filePath, line });
};

export type NavigationLoader = (
  namespace?: NamespaceEditable,
) => ResultAsync<NavigationItem[]>;
export type NavigationCache = {
  load: NavigationLoader;
  invalidate: () => void;
};

export const createNavigationCache = (
  kg: ReadonlyKnowledgeGraph,
): NavigationCache => {
  const cache: Record<NamespaceEditable, NavigationItem[] | null> = {
    record: null,
    config: null,
  };

  return {
    load: async (namespace = "record") => {
      const cached = cache[namespace];
      if (cached) return ok(cached);

      const result = await loadNavigation(kg, namespace);
      if (isErr(result)) return result;

      cache[namespace] = result.data;
      return result;
    },
    invalidate: () => {
      // config navigation items are hardcoded
      cache.record = null;
    },
  };
};

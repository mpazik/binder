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
  matchesFilters,
  mergeIncludes,
  type NamespaceEditable,
  pickByIncludes,
  type QueryParams,
  serializeFieldValue,
} from "@binder/db";
import {
  assertDefinedPass,
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
};

const emptyRenderResult = (): RenderResult => ({
  renderedPaths: [],
  modifiedPaths: [],
  divergedPaths: [],
});

const appendRenderResult = (
  target: RenderResult,
  next: RenderResult,
): RenderResult => {
  target.renderedPaths.push(...next.renderedPaths);
  target.modifiedPaths.push(...next.modifiedPaths);
  target.divergedPaths.push(...next.divergedPaths);
  return target;
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
    if (parentKey) {
      const siblings = childrenByParentKey.get(parentKey) ?? [];
      siblings.push(item);
      childrenByParentKey.set(parentKey, siblings);
    }
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
  kg: KnowledgeGraph,
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

// Returns `missing-path-field` error when a placeholder (including ancestral ones) is null/undefined.
export const resolvePath = (
  schema: EntitySchema,
  navItem: NavigationItem,
  entity: Fieldset,
  parentEntities: AncestralFieldsetChain = [],
): Result<string> => {
  const pathPattern = getPathPattern(navItem);
  const entityContext = [entity, ...parentEntities];

  return interpolatePlain(pathPattern, (placeholder) => {
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
};

const getExcludedFields = (
  namespace: NamespaceEditable,
  filters: Filters | undefined,
): string[] => {
  const excluded: string[] = ["id"];
  if (namespace === "config") excluded.push("uid");
  if (filters?.type && typeof filters.type !== "object") excluded.push("type");
  return excluded;
};

export const findView = (views: Views, key: string | undefined): ViewEntity =>
  views.find((t) => t.key === key) ??
  assertDefinedPass(
    views.find((t) => t.key === DOCUMENT_VIEW_KEY),
    `DOCUMENT_VIEW_KEY "${DOCUMENT_VIEW_KEY}" in views`,
  );

const renderContent = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  item: NavigationItem,
  entity: FieldsetNested,
  parentEntities: AncestralFieldsetChain,
  fileType: FileType,
  namespace: NamespaceEditable,
  views: Views,
): ResultAsync<string | null> => {
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
  const { db, kg, fs, paths, schema, version, namespace, views, log } = ctx;
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

    if (item.view) {
      const viewEntity = findView(views, item.view);
      interpolatedQuery.data.includes = mergeIncludes(
        mergeIncludes(interpolatedQuery.data.includes, viewEntity.viewIncludes),
        { key: true, uid: true },
      );
    } else if (interpolatedQuery.data.includes) {
      interpolatedQuery.data.includes = mergeIncludes(
        interpolatedQuery.data.includes,
        { key: true, uid: true },
      );
    }

    const searchResult = await kg.search(interpolatedQuery.data, namespace);
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
      if (resolvedPath.error.key === "missing-path-field") {
        const entityId =
          (entity.key as string | undefined) ??
          (entity.uid as string | undefined) ??
          "<unknown>";
        const missingFieldName = (
          resolvedPath.error.data as { fieldName?: unknown } | undefined
        )?.fieldName;

        log.warn(
          `Skipping render for entity '${entityId}' in navigation '${getPathPattern(item)}': missing value for path field '${String(missingFieldName ?? "unknown")}'.`,
        );
        continue;
      }
      return resolvedPath;
    }
    const filePath = join(parentPath, resolvedPath.data);

    const renderEntity =
      fieldsToStrip.length > 0
        ? (omit(entity, [...fieldsToStrip]) as FieldsetNested)
        : entity;

    const renderContentResult = await renderContent(
      kg,
      schema,
      item,
      renderEntity,
      parentEntities,
      fileType,
      namespace,
      views,
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
        ? [entity as Fieldset, ...parentEntities]
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

  return ok(result);
};

export const renderNavigation = async (
  ctx: Omit<RenderContext, "schema" | "version">,
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
    if (isErr(itemResult)) return itemResult;
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

  const filePath = join(paths.docs, resolvedPathResult.data);

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

export const createNavigationCache = (kg: KnowledgeGraph): NavigationCache => {
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

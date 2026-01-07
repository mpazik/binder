import { extname, join } from "path";
import {
  type AncestralFieldsetChain,
  emptyFieldset,
  type EntitySchema,
  type Fieldset,
  type FieldsetNested,
  type Filter,
  type Filters,
  formatFieldValue,
  type GraphVersion,
  type Includes,
  type KnowledgeGraph,
  matchesFilters,
  type NamespaceEditable,
  type QueryParams,
} from "@binder/db";
import {
  assertDefined,
  assertDefinedPass,
  isErr,
  ok,
  omit,
  type Result,
  type ResultAsync,
} from "@binder/utils";
import { sanitizeFilename } from "../utils/file.ts";
import {
  extractFieldValues,
  interpolateAncestralFields,
} from "../utils/interpolate-fields.ts";
import type { DatabaseCli } from "../db";
import { interpolateQueryParams } from "../utils/query.ts";
import { saveSnapshot } from "../lib/snapshot.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import { BINDER_DIR, type ConfigPaths } from "../config.ts";
import { parseTemplate, renderTemplate } from "./template.ts";
import {
  findEntityInYamlList,
  renderYamlEntity,
  renderYamlList,
} from "./yaml.ts";
import { formatReferences, formatReferencesList } from "./reference.ts";
import type { FileType } from "./document.ts";

export type RenderResult = {
  renderedPaths: string[];
  modifiedPaths: string[];
};

const emptyRenderResult = (): RenderResult => ({
  renderedPaths: [],
  modifiedPaths: [],
});

const mergeRenderResults = (results: RenderResult[]): RenderResult => ({
  renderedPaths: results.flatMap((r) => r.renderedPaths),
  modifiedPaths: results.flatMap((r) => r.modifiedPaths),
});

const inferFileType = (item: NavigationItem): FileType => {
  if (item.path.endsWith("/")) return "directory";
  if (item.template !== undefined) return "markdown";
  return "yaml";
};

const getExtension = (fileType: FileType): string => {
  if (fileType === "markdown") return ".md";
  if (fileType === "yaml") return ".yaml";
  return "";
};

export const getPathTemplate = (item: NavigationItem): string =>
  item.path + getExtension(inferFileType(item));

export type NavigationItem = {
  path: string;
  where?: Filters;
  template?: string;
  includes?: Includes;
  query?: QueryParams;
  children?: NavigationItem[];
};

export const SYSTEM_TEMPLATE_KEY = "__system__";
export const DEFAULT_TEMPLATE_KEY = "__default__";

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
    path: `${BINDER_DIR}/templates/{key}`,
    where: { type: "Template" },
    template: SYSTEM_TEMPLATE_KEY,
  },
];

export const getNavigationFilePatterns = (items: NavigationItem[]): string[] =>
  items.map((item) => {
    const template = getPathTemplate(item);
    const result = interpolateAncestralFields(template, () => "*");
    return isErr(result) ? template : result.data;
  });

export const loadNavigation = async (
  kg: KnowledgeGraph,
  namespace: NamespaceEditable = "node",
): ResultAsync<NavigationItem[]> => {
  if (namespace === "config") return ok(CONFIG_NAVIGATION_ITEMS);

  const searchResult = await kg.search(
    {
      filters: { type: "Navigation" },
    },
    "config",
  );

  if (isErr(searchResult)) return searchResult;

  const items = searchResult.data.items;
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
      template: item.template as string | undefined,
      includes: item.includes as Includes | undefined,
      query: item.query as QueryParams | undefined,
      ...(children && children.length > 0 ? { children } : {}),
    };
  };

  const roots = items
    .filter((item) => !item.parent)
    .map((root) => buildTree(root));

  return ok(roots);
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
    } else {
      const pathTemplate = item.path + getExtension(fileType);
      const pathFieldsResult = extractFieldValues(pathTemplate, path);
      if (isErr(pathFieldsResult)) continue;
      return item;
    }
  }
};

export const resolvePath = (
  navItem: NavigationItem,
  entity: Fieldset,
  parentEntities: AncestralFieldsetChain = [],
): Result<string> => {
  const fileType = inferFileType(navItem);
  const extension = getExtension(fileType);
  const pathTemplate = navItem.path + extension;
  const context = [entity, ...parentEntities];

  return interpolateAncestralFields(pathTemplate, (fieldName, depth) =>
    sanitizeFilename(formatFieldValue(context[depth]?.[fieldName])),
  );
};

const BUILTIN_TEMPLATES: Templates = [
  { key: SYSTEM_TEMPLATE_KEY, templateContent: `{templateContent}` },
  {
    key: DEFAULT_TEMPLATE_KEY,
    templateContent: `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
  },
];

const getParentDir = (filePath: string, fileType: FileType): string => {
  if (fileType === "directory") return filePath;
  const ext = extname(filePath);
  const withoutExt = ext ? filePath.slice(0, -ext.length) : filePath;
  return withoutExt + "/";
};

const isSingleValueFilter = (filter: Filter): boolean =>
  typeof filter !== "object" || filter === null;

const getExcludedFields = (
  namespace: NamespaceEditable,
  filters: Filters | undefined,
): readonly string[] => {
  const excluded: string[] = ["id"];
  if (namespace === "config") excluded.push("uid");

  // hide type, if only single type is being displayed
  if (filters?.type && isSingleValueFilter(filters.type)) excluded.push("type");
  return excluded;
};

export const findTemplate = (
  templates: Templates,
  key: string | undefined,
): TemplateEntity => {
  const found = templates.find((t) => t.key === key);
  if (found) return found;
  const defaultTemplate = templates.find((t) => t.key === DEFAULT_TEMPLATE_KEY);
  return assertDefinedPass(
    defaultTemplate,
    `DEFAULT_TEMPLATE_KEY "${DEFAULT_TEMPLATE_KEY}" in templates`,
  );
};

const resolveTemplateContent = (
  item: NavigationItem,
  templates: Templates,
): string | undefined => {
  if (!item.template) return undefined;
  return findTemplate(templates, item.template).templateContent;
};

const renderContent = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  item: NavigationItem,
  entity: FieldsetNested,
  parentEntities: Fieldset[],
  fileType: FileType,
  namespace: NamespaceEditable,
  templates: Templates,
): ResultAsync<string | null> => {
  if (fileType === "markdown") {
    const templateContent = resolveTemplateContent(item, templates);
    assertDefined(templateContent, "templateContent");
    const templateAst = parseTemplate(templateContent);
    const templateResult = renderTemplate(
      schema,
      templateAst,
      entity as Fieldset,
    );
    if (isErr(templateResult)) return templateResult;
    return ok(templateResult.data);
  }
  if (fileType === "yaml") {
    if (item.query) {
      const interpolatedQuery = interpolateQueryParams(item.query, [
        entity as Fieldset,
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

      if (item.query.includes) return ok(renderYamlList(formattedItems.data));

      const excludedFields = getExcludedFields(namespace, item.query.filters);
      const filteredItems = formattedItems.data.map((e) =>
        omit(e, excludedFields),
      );
      return ok(renderYamlList(filteredItems));
    }
    const formattedEntity = await formatReferences(entity, schema, kg);
    if (isErr(formattedEntity)) return formattedEntity;

    const excludedFields = getExcludedFields(namespace, item.where);
    const filteredEntity = omit(formattedEntity.data, excludedFields);
    return ok(renderYamlEntity(filteredEntity));
  }
  return ok(null);
};

const renderNavigationItem = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  paths: ConfigPaths,
  schema: EntitySchema,
  version: GraphVersion,
  item: NavigationItem,
  parentPath: string,
  parentEntities: Fieldset[],
  namespace: NamespaceEditable,
  templates: Templates,
): ResultAsync<RenderResult> => {
  const fileType = inferFileType(item);
  const result = emptyRenderResult();

  let entities: FieldsetNested[] = [];
  let shouldUpdateParentContext = false;

  if (item.where) {
    const queryParams: QueryParams = {
      filters: item.where,
      includes: item.includes,
    };
    const interpolatedQuery = interpolateQueryParams(
      queryParams,
      parentEntities,
    );
    if (isErr(interpolatedQuery)) return interpolatedQuery;

    const searchResult = await kg.search(interpolatedQuery.data, namespace);
    if (isErr(searchResult)) return searchResult;

    entities = searchResult.data.items;
    shouldUpdateParentContext = true;
  } else if (parentEntities.length > 0) {
    entities = [parentEntities[0]!];
    shouldUpdateParentContext = false;
  } else {
    entities = [emptyFieldset];
    shouldUpdateParentContext = false;
  }

  for (const entity of entities) {
    const resolvedPath = resolvePath(item, entity as Fieldset, parentEntities);
    if (isErr(resolvedPath)) return resolvedPath;
    const filePath = join(parentPath, resolvedPath.data);

    const renderContentResult = await renderContent(
      kg,
      schema,
      item,
      entity,
      parentEntities,
      fileType,
      namespace,
      templates,
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
      );
      if (isErr(saveResult)) return saveResult;

      result.renderedPaths.push(filePath);
      if (saveResult.data) {
        result.modifiedPaths.push(filePath);
      }
    }

    if (item.children) {
      const itemDir = getParentDir(filePath, fileType);
      const childParentEntities = shouldUpdateParentContext
        ? [entity as Fieldset, ...parentEntities]
        : parentEntities;

      for (const child of item.children) {
        const childResult = await renderNavigationItem(
          db,
          kg,
          fs,
          paths,
          schema,
          version,
          child,
          itemDir,
          childParentEntities,
          namespace,
          templates,
        );
        if (isErr(childResult)) return childResult;

        result.renderedPaths.push(...childResult.data.renderedPaths);
        result.modifiedPaths.push(...childResult.data.modifiedPaths);
      }
    }
  }

  return ok(result);
};

export const renderNavigation = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  paths: ConfigPaths,
  navigationItems: NavigationItem[],
  namespace: NamespaceEditable = "node",
): ResultAsync<RenderResult> => {
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;
  const schema = schemaResult.data;

  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;
  const templatesResult = await loadTemplates(kg);
  if (isErr(templatesResult)) return templatesResult;

  const results: RenderResult[] = [];

  for (const item of navigationItems) {
    const result = await renderNavigationItem(
      db,
      kg,
      fs,
      paths,
      schema,
      versionResult.data,
      item,
      "",
      [],
      namespace,
      templatesResult.data,
    );
    if (isErr(result)) return result;
    results.push(result.data);
  }

  return ok(mergeRenderResults(results));
};

export type DefinitionLocation = {
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
  const flattened = flattenNavigationItems(items);

  const matches: { item: NavigationItem; score: number }[] = [];

  for (const item of flattened) {
    const filters = item.where ?? item.query?.filters;
    if (!filters) continue;
    if (!matchesFilters(filters, entity)) continue;

    matches.push({ item, score: scoreNavItem(item) });
  }

  if (matches.length === 0) return undefined;

  matches.sort((a, b) => b.score - a.score);
  return matches[0]!.item;
};

export const findEntityLocation = async (
  fs: FileSystem,
  paths: ConfigPaths,
  entity: Fieldset,
  navigation: NavigationItem[],
): ResultAsync<DefinitionLocation | undefined> => {
  const navItem = findMatchingNavItem(navigation, entity);
  if (!navItem) return ok(undefined);

  const resolvedPathResult = resolvePath(navItem, entity, []);
  if (isErr(resolvedPathResult)) return resolvedPathResult;

  const relativePath = resolvedPathResult.data;
  const filePath = join(paths.docs, relativePath);

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
    node: null,
    config: null,
  };

  return {
    load: async (namespace = "node") => {
      const cached = cache[namespace];
      if (cached) return ok(cached);

      const result = await loadNavigation(kg, namespace);
      if (isErr(result)) return result;

      cache[namespace] = result.data;
      return result;
    },
    invalidate: () => {
      // config navigation items are hardcoded
      cache.node = null;
    },
  };
};

export type TemplateEntity = {
  key: string;
  name?: string;
  description?: string;
  preamble?: string[];
  templateContent: string;
};

export type Templates = TemplateEntity[];

export const loadTemplates = async (
  kg: KnowledgeGraph,
): ResultAsync<Templates> => {
  const searchResult = await kg.search(
    { filters: { type: "Template" } },
    "config",
  );
  if (isErr(searchResult)) return searchResult;

  const templates: Templates = searchResult.data.items.map((item) => ({
    key: item.key as string,
    name: item.name as string | undefined,
    description: item.description as string | undefined,
    preamble: item.preamble as string[] | undefined,
    templateContent: item.templateContent as string,
  }));

  return ok([...BUILTIN_TEMPLATES, ...templates]);
};

export type TemplateLoader = () => ResultAsync<Templates>;
export type TemplateCache = {
  load: TemplateLoader;
  invalidate: () => void;
};

export const createTemplateCache = (kg: KnowledgeGraph): TemplateCache => {
  let cache: Templates | null = null;

  return {
    load: async () => {
      if (cache) return ok(cache);

      const result = await loadTemplates(kg);
      if (isErr(result)) return result;

      cache = result.data;
      return result;
    },
    invalidate: () => {
      cache = null;
    },
  };
};

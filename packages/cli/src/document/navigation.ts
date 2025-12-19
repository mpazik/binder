import { extname, join } from "path";
import {
  emptyFieldset,
  type Fieldset,
  type FieldsetNested,
  type Filters,
  formatFieldValue,
  type GraphVersion,
  type Includes,
  type KnowledgeGraph,
  type NamespaceEditable,
  type AncestralFieldsetChain,
  type NodeSchema,
  type QueryParams,
} from "@binder/db";
import {
  assertDefined,
  isErr,
  ok,
  okVoid,
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
import { type ConfigPaths } from "../config.ts";
import { parseView } from "./markdown.ts";
import { renderView } from "./view.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { formatReferences, formatReferencesList } from "./reference.ts";
import type { FileType } from "./document.ts";

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

export const getPathTemplate = (item: NavigationItem): string =>
  item.path + getExtension(inferFileType(item));

export type NavigationItem = {
  path: string;
  where?: Filters;
  view?: string;
  includes?: Includes;
  query?: QueryParams;
  children?: NavigationItem[];
};

export const CONFIG_NAVIGATION_ITEMS: NavigationItem[] = [
  {
    path: ".binder/fields",
    query: {
      filters: { type: "Field" },
      includes: {
        key: true,
        name: true,
        description: true,
        dataType: true,
        when: true,
        allowMultiple: true,
        default: true,
        unique: true,
        range: true,
        inverseOf: true,
        options: true,
      },
    },
  },
  {
    path: ".binder/types",
    query: {
      filters: { type: "Type" },
      includes: {
        key: true,
        name: true,
        description: true,
        fields: true,
      },
    },
  },
  {
    path: ".binder/navigation",
    query: {
      filters: { type: "Navigation" },
      includes: {
        key: true,
        path: true,
        where: true,
        query: true,
        parent: true,
        children: true,
      },
    },
  },
];

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
      view: item.view as string | undefined,
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

export const DEFAULT_DYNAMIC_VIEW = `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`;

const getParentDir = (filePath: string, fileType: FileType): string => {
  if (fileType === "directory") return filePath;
  const ext = extname(filePath);
  const withoutExt = ext ? filePath.slice(0, -ext.length) : filePath;
  return withoutExt + "/";
};

const renderContent = async (
  kg: KnowledgeGraph,
  schema: NodeSchema,
  item: NavigationItem,
  entity: FieldsetNested,
  parentEntities: Fieldset[],
  fileType: FileType,
  namespace: NamespaceEditable,
): Promise<Result<string> | undefined> => {
  if (fileType === "markdown") {
    assertDefined(item.view);
    const viewAst = parseView(item.view);
    const viewResult = renderView(schema, viewAst, entity as Fieldset);
    if (isErr(viewResult)) return viewResult;
    return ok(viewResult.data);
  } else if (fileType === "yaml") {
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

      return ok(renderYamlList(formattedItems.data));
    } else {
      const formattedEntity = await formatReferences(entity, schema, kg);
      if (isErr(formattedEntity)) return formattedEntity;

      return ok(renderYamlEntity(formattedEntity.data));
    }
  }
};

const renderNavigationItem = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  paths: ConfigPaths,
  schema: NodeSchema,
  version: GraphVersion,
  item: NavigationItem,
  parentPath: string,
  parentEntities: Fieldset[],
  namespace: NamespaceEditable,
): ResultAsync<void> => {
  const fileType = inferFileType(item);

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

    const renderResult = await renderContent(
      kg,
      schema,
      item,
      entity,
      parentEntities,
      fileType,
      namespace,
    );

    if (renderResult) {
      if (isErr(renderResult)) return renderResult;
      const saveResult = await saveSnapshot(
        db,
        fs,
        paths,
        filePath,
        renderResult.data,
        version,
      );
      if (isErr(saveResult)) return saveResult;
    }

    if (item.children) {
      const itemDir = getParentDir(filePath, fileType);
      const childParentEntities = shouldUpdateParentContext
        ? [entity as Fieldset, ...parentEntities]
        : parentEntities;

      for (const child of item.children) {
        const result = await renderNavigationItem(
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
        );
        if (isErr(result)) return result;
      }
    }
  }

  return okVoid;
};

export const renderNavigation = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  paths: ConfigPaths,
  navigationItems: NavigationItem[],
  namespace: NamespaceEditable = "node",
): ResultAsync<void> => {
  const schemaResult = await kg.getNodeSchema();
  if (isErr(schemaResult)) return schemaResult;
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  for (const item of navigationItems) {
    const result = await renderNavigationItem(
      db,
      kg,
      fs,
      paths,
      schemaResult.data,
      versionResult.data,
      item,
      "",
      [],
      namespace,
    );
    if (isErr(result)) return result;
  }
  return okVoid;
};

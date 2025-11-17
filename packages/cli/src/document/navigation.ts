import { extname, join } from "path";
import { z } from "zod";
import * as YAML from "yaml";
import {
  emptyFieldset,
  type Fieldset,
  type FieldsetNested,
  FiltersSchema,
  formatValue,
  type GraphVersion,
  type Includes,
  IncludesSchema,
  type KnowledgeGraph,
  type NodeSchema,
  type QueryParams,
  QueryParamsSchema,
} from "@binder/db";
import {
  assertDefined,
  includes,
  isErr,
  ok,
  okVoid,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { sanitizeFilename } from "../utils/file.ts";
import {
  extractFieldValues,
  interpolateFields,
} from "../utils/interpolate-fields.ts";
import type { DatabaseCli } from "../db";
import { interpolateQueryParams } from "../utils/query.ts";
import { saveSnapshot } from "../lib/snapshot.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import { parseView } from "./markdown.ts";
import { renderView } from "./view.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";

export const SUPPORTED_MARKDOWN_EXTS = [".md", ".mdx"] as const;
export const SUPPORTED_YAML_EXTS = [".yaml", ".yml"] as const;
export const SUPPORTED_SNAPSHOT_EXTS = [
  ...SUPPORTED_MARKDOWN_EXTS,
  ...SUPPORTED_YAML_EXTS,
] as const;

type FileType = "directory" | "markdown" | "yaml" | "unknown";

export const getSnapshotFileType = (path: string): FileType => {
  if (path.endsWith("/")) return "directory";
  const ext = extname(path);
  if (!ext) return "directory";
  if (includes(SUPPORTED_MARKDOWN_EXTS, ext)) return "markdown";
  if (includes(SUPPORTED_YAML_EXTS, ext)) return "yaml";
  return "unknown";
};

const NavigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() => {
  const base = {
    where: FiltersSchema.optional(),
    children: z.array(NavigationItemSchema).optional(),
  };
  return z.union([
    z.object({
      ...base,
      path: z
        .string()
        .refine((p) => includes(SUPPORTED_MARKDOWN_EXTS, extname(p))),
      view: z.string(),
    }),
    z.object({
      ...base,
      path: z.string().refine((p) => includes(SUPPORTED_YAML_EXTS, extname(p))),
      includes: IncludesSchema,
    }),
    z.object({
      ...base,
      path: z.string().refine((p) => includes(SUPPORTED_YAML_EXTS, extname(p))),
      query: QueryParamsSchema,
    }),
    z.object({
      ...base,
      path: z.string().refine((p) => getSnapshotFileType(p) === "directory"),
    }),
  ]);
});

const NavigationConfigSchema = z.object({
  navigation: z.array(NavigationItemSchema),
});

export type NavigationItem = {
  path: string;
  where?: QueryParams["filters"];
  view?: string;
  includes?: Includes;
  query?: QueryParams;
  children?: NavigationItem[];
};

export const loadNavigation = async (
  fs: FileSystem,
  binderPath: string,
): ResultAsync<NavigationItem[]> => {
  const navigationPath = join(binderPath, "navigation.yaml");

  const fileResult = await fs.readFile(navigationPath);
  if (isErr(fileResult)) return fileResult;

  const parseResult = tryCatch(() =>
    NavigationConfigSchema.parse(YAML.parse(fileResult.data)),
  );
  if (isErr(parseResult)) return parseResult;

  return ok(parseResult.data.navigation);
};

export const findNavigationItemByPath = (
  items: NavigationItem[],
  path: string,
): NavigationItem | undefined => {
  for (const item of items) {
    const fileType = getSnapshotFileType(item.path);

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
      const pathFieldsResult = extractFieldValues(item.path, path);
      if (isErr(pathFieldsResult)) continue;
      return item;
    }
  }
};

export const resolvePath = (template: string, item: Fieldset): Result<string> =>
  interpolateFields(template, (key) =>
    sanitizeFilename(formatValue(item[key])),
  );

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

      const queryResult = await kg.search(interpolatedQuery.data);
      if (isErr(queryResult)) return queryResult;

      return ok(renderYamlList(queryResult.data.items));
    } else {
      return ok(renderYamlEntity(entity));
    }
  }
};

const renderNavigationItem = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  docsPath: string,
  schema: NodeSchema,
  version: GraphVersion,
  item: NavigationItem,
  parentPath: string,
  parentEntities: Fieldset[],
): ResultAsync<void> => {
  const fileType = getSnapshotFileType(item.path);

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

    const searchResult = await kg.search(interpolatedQuery.data);
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
    const resolvedPath = resolvePath(item.path, entity as Fieldset);
    if (isErr(resolvedPath)) return resolvedPath;
    const filePath = join(parentPath, resolvedPath.data);

    const renderResult = await renderContent(
      kg,
      schema,
      item,
      entity,
      parentEntities,
      fileType,
    );

    if (renderResult) {
      if (isErr(renderResult)) return renderResult;
      const saveResult = await saveSnapshot(
        db,
        fs,
        join(docsPath, filePath),
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
          docsPath,
          schema,
          version,
          child,
          itemDir,
          childParentEntities,
        );
        if (isErr(result)) return result;
      }
    }
  }

  return ok(undefined);
};

export const renderNavigation = async (
  db: DatabaseCli,
  kg: KnowledgeGraph,
  fs: FileSystem,
  docsPath: string,
  navigationItems: NavigationItem[],
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
      docsPath,
      schemaResult.data,
      versionResult.data,
      item,
      "",
      [],
    );
    if (isErr(result)) return result;
  }
  return okVoid;
};

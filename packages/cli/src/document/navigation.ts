import { join } from "path";
import { z } from "zod";
import * as YAML from "yaml";
import {
  emptyFieldset,
  type Fieldset,
  formatValue,
  type GraphVersion,
  type KnowledgeGraph,
  type NodeSchema,
} from "@binder/db";
import {
  createError,
  err,
  type ErrorObject,
  isErr,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import type { FileSystem } from "../lib/filesystem.ts";
import { sanitizeFilename } from "../utils/file.ts";
import {
  extractFieldNames,
  interpolateFields,
} from "../utils/interpolate-fields.ts";
import { saveSnapshot } from "../lib/snapshot.ts";
import type { DatabaseCli } from "../db";
import { parseStringQuery } from "../utils/query.ts";
import { parseView } from "./markdown.ts";
import { renderView } from "./view.ts";

const NavigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() =>
  z.object({
    path: z.string(),
    query: z.string().optional(),
    view: z.string().optional(),
    children: z.array(NavigationItemSchema).optional(),
  }),
);

const NavigationConfigSchema = z.object({
  navigation: z.array(NavigationItemSchema),
});

export type NavigationItem = {
  path: string;
  query?: string;
  view?: string;
  children?: NavigationItem[];
};

export type NavigationError = {
  path: string;
  error: ErrorObject;
  context?: Record<string, unknown>;
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

export const resolvePath = (template: string, item: Fieldset): Result<string> =>
  interpolateFields(template, (key) =>
    sanitizeFilename(formatValue(item[key])),
  );

export const extractFieldsFromPath = (
  path: string,
  pathTemplate: string,
): Result<Fieldset> => {
  const fieldNames = extractFieldNames(pathTemplate);
  const regexPattern = pathTemplate.replace(/\{([\w.-]+)}/g, () => "([^/]+)");

  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);

  if (!match) {
    return err(
      createError(
        "path_template_mismatch",
        "Path does not match the template",
        { path, pathTemplate },
      ),
    );
  }

  const fieldSet: Fieldset = {};
  fieldNames.forEach((fieldName, index) => {
    fieldSet[fieldName] = match[index + 1];
  });

  return ok(fieldSet);
};

export const DEFAULT_DYNAMIC_VIEW = `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`;

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
  errors: NavigationError[],
): ResultAsync<void> => {
  const viewAst = parseView(item.view ?? DEFAULT_DYNAMIC_VIEW);

  let entities: Fieldset[] = [];
  let shouldUpdateParentContext = false;

  if (item.query) {
    const queryResult = parseStringQuery(item.query, parentEntities);
    if (isErr(queryResult)) return queryResult;
    const searchResult = await kg.search(queryResult.data);
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
    const resolvedPath = resolvePath(item.path, entity);
    if (isErr(resolvedPath)) return resolvedPath;
    const fullPath = join(parentPath, resolvedPath.data);
    const isDirectory = fullPath.endsWith("/");

    if (!isDirectory) {
      const filePath = join(docsPath, fullPath);
      const renderResult = renderView(schema, viewAst, entity);
      if (isErr(renderResult)) {
        errors.push({
          path: fullPath,
          error: renderResult.error,
          context: { uid: entity.uid },
        });
        continue;
      }

      const saveResult = await saveSnapshot(
        db,
        fs,
        filePath,
        renderResult.data,
        version,
      );
      if (isErr(saveResult)) {
        errors.push({
          path: fullPath,
          error: saveResult.error,
          context: { uid: entity.uid },
        });
        continue;
      }
    }

    if (item.children) {
      const itemDir = isDirectory ? fullPath : fullPath.slice(0, -3);
      const childParentEntities = shouldUpdateParentContext
        ? [entity, ...parentEntities]
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
          errors,
        );
        if (isErr(result)) {
          errors.push({
            path: fullPath,
            error: result.error,
          });
        }
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
): ResultAsync<NavigationError[]> => {
  const schemaResult = await kg.getNodeSchema();
  if (isErr(schemaResult)) return schemaResult;
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const errors: NavigationError[] = [];
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
      errors,
    );
    if (isErr(result)) return result;
  }
  return ok(errors);
};

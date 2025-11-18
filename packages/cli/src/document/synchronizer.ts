import { join } from "path";
import type {
  Fieldset,
  FieldsetNested,
  KnowledgeGraph,
  NamespaceEditable,
  NodeSchema,
  TransactionId,
  TransactionInput,
} from "@binder/db";
import { createError, err, isErr, ok, type ResultAsync } from "@binder/utils";
import { extractFieldValues } from "../utils/interpolate-fields.ts";
import { diffNodeLists, diffNodeTrees } from "../utils/node-diff.ts";
import { interpolateQueryParams } from "../utils/query.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { FileChangeMetadata } from "../lib/snapshot.ts";
import { renderPathForNamespace, type AppConfig } from "../config.ts";
import {
  DEFAULT_DYNAMIC_VIEW,
  findNavigationItemByPath,
  getSnapshotFileType,
  type NavigationItem,
} from "./navigation.ts";
import { parseMarkdown, parseView } from "./markdown.ts";
import { extractFields } from "./view.ts";
import { parseYamlEntity, parseYamlList } from "./yaml.ts";

export { diffNodeTrees } from "../utils/node-diff.ts";

type ParsedFileResult =
  | { kind: "single"; file: FieldsetNested; kg: FieldsetNested }
  | { kind: "list"; file: FieldsetNested[]; kg: FieldsetNested[] };

const extractFromYamlSingle = async (
  kg: KnowledgeGraph,
  _navItem: NavigationItem,
  content: string,
  pathFields: Fieldset,
  namespace: NamespaceEditable,
): ResultAsync<ParsedFileResult> => {
  const parseResult = parseYamlEntity(content);
  if (isErr(parseResult)) return parseResult;

  const kgSearchResult = await kg.search(
    {
      filters: pathFields as Record<string, string>,
    },
    namespace,
  );
  if (isErr(kgSearchResult)) return kgSearchResult;

  if (kgSearchResult.data.items.length !== 1) {
    return err(
      createError(
        "invalid_node_count",
        "Path fields must resolve to exactly one node",
        {
          pathFields,
          nodeCount: kgSearchResult.data.items.length,
        },
      ),
    );
  }

  return ok({
    kind: "single",
    file: parseResult.data,
    kg: kgSearchResult.data.items[0]!,
  });
};

const extractFromYamlList = async (
  kg: KnowledgeGraph,
  navItem: NavigationItem,
  content: string,
  pathFields: Fieldset,
  namespace: NamespaceEditable,
): ResultAsync<ParsedFileResult> => {
  const parseResult = parseYamlList(content);
  if (isErr(parseResult)) return parseResult;

  if (!navItem.query) {
    return err(
      createError(
        "missing_query",
        "Navigation item with YAML list must have query",
      ),
    );
  }

  const interpolatedQuery = interpolateQueryParams(navItem.query, [pathFields]);
  if (isErr(interpolatedQuery)) return interpolatedQuery;

  const kgSearchResult = await kg.search(interpolatedQuery.data, namespace);
  if (isErr(kgSearchResult)) return kgSearchResult;

  return ok({
    kind: "list",
    file: parseResult.data,
    kg: kgSearchResult.data.items,
  });
};

const extractFromMarkdown = async (
  kg: KnowledgeGraph,
  schema: NodeSchema,
  navItem: NavigationItem,
  markdown: string,
  pathFields: Fieldset,
  namespace: NamespaceEditable,
): ResultAsync<ParsedFileResult> => {
  const templateString = navItem.view ?? DEFAULT_DYNAMIC_VIEW;
  const viewAst = parseView(templateString);
  const markdownAst = parseMarkdown(markdown);
  const fileFieldsResult = extractFields(schema, viewAst, markdownAst);
  if (isErr(fileFieldsResult)) return fileFieldsResult;

  const kgSearchResult = await kg.search(
    {
      filters: pathFields as Record<string, string>,
    },
    namespace,
  );
  if (isErr(kgSearchResult)) return kgSearchResult;

  if (kgSearchResult.data.items.length !== 1) {
    return err(
      createError(
        "invalid_node_count",
        "Path fields must resolve to exactly one node",
        {
          pathFields,
          nodeCount: kgSearchResult.data.items.length,
        },
      ),
    );
  }

  return ok({
    kind: "single",
    file: fileFieldsResult.data,
    kg: kgSearchResult.data.items[0]!,
  });
};

const extractFromFile = async (
  kg: KnowledgeGraph,
  schema: NodeSchema,
  navItem: NavigationItem,
  content: string,
  pathFields: Fieldset,
  filePath: string,
  namespace: NamespaceEditable,
): ResultAsync<ParsedFileResult> => {
  const fileType = getSnapshotFileType(filePath);

  if (fileType === "yaml") {
    if (navItem.includes)
      return extractFromYamlSingle(kg, navItem, content, pathFields, namespace);
    if (navItem.query)
      return extractFromYamlList(kg, navItem, content, pathFields, namespace);
    return err(
      createError(
        "invalid_yaml_config",
        "YAML navigation item must have includes or query",
      ),
    );
  }
  if (fileType === "markdown")
    return extractFromMarkdown(
      kg,
      schema,
      navItem,
      content,
      pathFields,
      namespace,
    );

  return err(
    createError("unsupported_file_type", "Unsupported file type", {
      path: filePath,
      fileType,
    }),
  );
};

export const synchronizeFile = async (
  fs: FileSystem,
  kg: KnowledgeGraph,
  config: AppConfig,
  navigationItems: NavigationItem[],
  schema: NodeSchema,
  relativePath: string,
  namespace: NamespaceEditable = "node",
  _txVersion?: TransactionId, // we should later use it to fetch data for a given version for fair comparison
): ResultAsync<TransactionInput | null> => {
  const navItem = findNavigationItemByPath(navigationItems, relativePath);
  if (!navItem) {
    return err(
      createError(
        "yaml_file_not_found",
        "YAML file not found in navigation config",
        { path: relativePath },
      ),
    );
  }

  const pathFieldsResult = extractFieldValues(navItem.path, relativePath);
  if (isErr(pathFieldsResult)) return pathFieldsResult;
  const pathFields = pathFieldsResult.data;

  const absolutePath = join(
    renderPathForNamespace(namespace, config.paths),
    relativePath,
  );
  const contentResult = await fs.readFile(absolutePath);
  if (isErr(contentResult)) return contentResult;

  const extractResult = await extractFromFile(
    kg,
    schema,
    navItem,
    contentResult.data,
    pathFields,
    absolutePath,
    namespace,
  );
  if (isErr(extractResult)) return extractResult;

  const data = extractResult.data;
  const diffResult =
    data.kind === "single"
      ? diffNodeTrees(data.file, data.kg)
      : diffNodeLists(data.file, data.kg);
  if (isErr(diffResult)) return diffResult;

  if (diffResult.data.length === 0) {
    return ok(null);
  }

  return ok({
    author: config.author,
    nodes: diffResult.data,
  });
};

export const synchronizeModifiedFiles = async (
  fs: FileSystem,
  kg: KnowledgeGraph,
  config: AppConfig,
  navigationItems: NavigationItem[],
  schema: NodeSchema,
  modifiedFiles: FileChangeMetadata[],
  namespace: NamespaceEditable = "node",
): ResultAsync<TransactionInput | null> => {
  const allNodes: TransactionInput["nodes"] = [];

  for (const file of modifiedFiles) {
    const syncResult = await synchronizeFile(
      fs,
      kg,
      config,
      navigationItems,
      schema,
      file.path,
      namespace,
    );
    if (isErr(syncResult)) return syncResult;

    if (syncResult.data?.nodes) {
      allNodes.push(...syncResult.data.nodes);
    }
  }

  if (allNodes.length === 0) {
    return ok(null);
  }

  return ok({
    author: config.author,
    nodes: allNodes,
  });
};

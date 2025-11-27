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
import {
  resolveSnapshotPath,
  type SnapshotChangeMetadata,
} from "../lib/snapshot.ts";
import { type AppConfig } from "../config.ts";
import {
  DEFAULT_DYNAMIC_VIEW,
  findNavigationItemByPath,
  type NavigationItem,
} from "./navigation.ts";
import { parseMarkdown, parseView } from "./markdown.ts";
import { extractFields } from "./view.ts";
import { parseYamlEntity, parseYamlList } from "./yaml.ts";
import { getDocumentFileType } from "./document.ts";
import { normalizeReferences, normalizeReferencesList } from "./reference.ts";

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
  const fileType = getDocumentFileType(filePath);

  let result: ResultAsync<ParsedFileResult>;

  if (fileType === "yaml") {
    if (navItem.includes) {
      result = extractFromYamlSingle(
        kg,
        navItem,
        content,
        pathFields,
        namespace,
      );
    } else if (navItem.query) {
      result = extractFromYamlList(kg, navItem, content, pathFields, namespace);
    } else {
      return err(
        createError(
          "invalid_yaml_config",
          "YAML navigation item must have includes or query",
        ),
      );
    }
  } else if (fileType === "markdown") {
    result = extractFromMarkdown(
      kg,
      schema,
      navItem,
      content,
      pathFields,
      namespace,
    );
  } else {
    return err(
      createError("unsupported_file_type", "Unsupported file type", {
        path: filePath,
      }),
    );
  }

  const extracted = await result;
  if (isErr(extracted)) return extracted;

  if (extracted.data.kind === "single") {
    const normalizedFile = await normalizeReferences(
      extracted.data.file,
      schema,
      kg,
    );
    if (isErr(normalizedFile)) return normalizedFile;
    return ok({ ...extracted.data, file: normalizedFile.data });
  }

  const normalizedFile = await normalizeReferencesList(
    extracted.data.file,
    schema,
    kg,
  );
  if (isErr(normalizedFile)) return normalizedFile;
  return ok({ ...extracted.data, file: normalizedFile.data });
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

  const absolutePath = resolveSnapshotPath(relativePath, config.paths);
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

  if (diffResult.data.length === 0) return ok(null);

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
  modifiedFiles: SnapshotChangeMetadata[],
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

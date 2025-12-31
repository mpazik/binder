import type {
  ChangesetsInput,
  EntitySchema,
  Fieldset,
  FieldsetNested,
  KnowledgeGraph,
  NamespaceEditable,
  QueryParams,
  TransactionId,
  TransactionInput,
} from "@binder/db";
import { fail, isErr, ok, type ResultAsync } from "@binder/utils";
import { extractFieldValues } from "../utils/interpolate-fields.ts";
import { interpolateQueryParams } from "../utils/query.ts";
import { diffEntities, diffQueryResults } from "../diff";
import type { FileSystem } from "../lib/filesystem.ts";
import {
  modifiedSnapshots,
  namespaceFromSnapshotPath,
  resolveSnapshotPath,
  type SnapshotChangeMetadata,
  snapshotRootForNamespace,
} from "../lib/snapshot.ts";
import type { DatabaseCli } from "../db";
import { type AppConfig } from "../config.ts";
import type { MatchOptions } from "../utils/file.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  findNavigationItemByPath,
  getNavigationFilePatterns,
  getPathTemplate,
  loadNavigation,
  type NavigationItem,
} from "./navigation.ts";
import {
  extract,
  type ExtractedFileData,
  type ExtractedProjection,
} from "./extraction.ts";
import { normalizeReferences, normalizeReferencesList } from "./reference.ts";

const synchronizeSingle = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  entity: FieldsetNested,
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  const kgResult = await kg.search(
    { filters: pathFields as Record<string, string> },
    namespace,
  );
  if (isErr(kgResult)) return kgResult;

  if (kgResult.data.items.length !== 1) {
    return fail(
      "invalid_node_count",
      "Path fields must resolve to exactly one node",
      { pathFields, nodeCount: kgResult.data.items.length },
    );
  }

  const normalizedResult = await normalizeReferences(entity, schema, kg);
  if (isErr(normalizedResult)) return normalizedResult;

  return ok(
    diffEntities(schema, normalizedResult.data, kgResult.data.items[0]!),
  );
};

const synchronizeList = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  entities: FieldsetNested[],
  query: QueryParams,
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  const interpolatedQuery = interpolateQueryParams(query, [pathFields]);
  if (isErr(interpolatedQuery)) return interpolatedQuery;

  const kgResult = await kg.search(interpolatedQuery.data, namespace);
  if (isErr(kgResult)) return kgResult;

  const normalizedResult = await normalizeReferencesList(entities, schema, kg);
  if (isErr(normalizedResult)) return normalizedResult;

  const diffResult = diffQueryResults(
    schema,
    normalizedResult.data,
    kgResult.data.items,
    interpolatedQuery.data,
  );

  return ok([...diffResult.toCreate, ...diffResult.toUpdate]);
};

const synchronizeProjection = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  projection: ExtractedProjection,
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  const interpolatedQuery = interpolateQueryParams(projection.query, [
    pathFields,
  ]);
  if (isErr(interpolatedQuery)) return interpolatedQuery;

  const kgResult = await kg.search(interpolatedQuery.data, namespace);
  if (isErr(kgResult)) return kgResult;

  const normalizedResult = await normalizeReferencesList(
    projection.items,
    schema,
    kg,
  );
  if (isErr(normalizedResult)) return normalizedResult;

  const diffResult = diffQueryResults(
    schema,
    normalizedResult.data,
    kgResult.data.items,
    interpolatedQuery.data,
  );

  return ok([...diffResult.toCreate, ...diffResult.toUpdate]);
};

const synchronizeDocument = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  entity: FieldsetNested,
  projections: ExtractedProjection[],
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  const kgResult = await kg.search(
    { filters: pathFields as Record<string, string> },
    namespace,
  );
  if (isErr(kgResult)) return kgResult;

  if (kgResult.data.items.length !== 1) {
    return fail(
      "invalid_node_count",
      "Path fields must resolve to exactly one node",
      { pathFields, nodeCount: kgResult.data.items.length },
    );
  }

  const normalizedResult = await normalizeReferences(entity, schema, kg);
  if (isErr(normalizedResult)) return normalizedResult;

  const changesets: ChangesetsInput = diffEntities(
    schema,
    normalizedResult.data,
    kgResult.data.items[0]!,
  );

  for (const projection of projections) {
    const projectionResult = await synchronizeProjection(
      kg,
      schema,
      namespace,
      projection,
      pathFields,
    );
    if (isErr(projectionResult)) return projectionResult;
    changesets.push(...projectionResult.data);
  }

  return ok(changesets);
};

const synchronizeExtracted = (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  data: ExtractedFileData,
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  if (data.kind === "single") {
    return synchronizeSingle(kg, schema, namespace, data.entity, pathFields);
  }

  if (data.kind === "list") {
    return synchronizeList(
      kg,
      schema,
      namespace,
      data.entities,
      data.query,
      pathFields,
    );
  }

  return synchronizeDocument(
    kg,
    schema,
    namespace,
    data.entity,
    data.projections,
    pathFields,
  );
};

export const synchronizeFile = async <N extends NamespaceEditable>(
  fs: FileSystem,
  kg: KnowledgeGraph,
  config: AppConfig,
  navigationItems: NavigationItem[],
  schema: EntitySchema,
  relativePath: string,
  namespace: N,
  _txVersion?: TransactionId,
): ResultAsync<ChangesetsInput<N>> => {
  const navItem = findNavigationItemByPath(navigationItems, relativePath);
  if (!navItem) {
    return fail(
      "navigation_item_not_found",
      "Not found item in navigation config for the path",
      { path: relativePath },
    );
  }

  const pathFieldsResult = extractFieldValues(
    getPathTemplate(navItem),
    relativePath,
  );
  if (isErr(pathFieldsResult)) return pathFieldsResult;
  const pathFields = pathFieldsResult.data;

  const absolutePath = resolveSnapshotPath(relativePath, config.paths);
  const contentResult = await fs.readFile(absolutePath);
  if (isErr(contentResult)) return contentResult;

  const extractResult = extract(
    schema,
    navItem,
    contentResult.data,
    absolutePath,
  );
  if (isErr(extractResult)) return extractResult;

  return synchronizeExtracted(
    kg,
    schema,
    namespace,
    extractResult.data,
    pathFields,
  );
};

const synchronizeNamespaceFiles = async <N extends NamespaceEditable>(
  fs: FileSystem,
  kg: KnowledgeGraph,
  config: AppConfig,
  navigationItems: NavigationItem[],
  schema: EntitySchema,
  modifiedFiles: SnapshotChangeMetadata[],
  namespace: N,
): ResultAsync<ChangesetsInput<N>> => {
  const changesets: ChangesetsInput<N> = [];

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

    changesets.push(...syncResult.data);
  }

  return ok(changesets);
};

export const synchronizeModifiedFiles = async (
  db: DatabaseCli,
  fs: FileSystem,
  kg: KnowledgeGraph,
  config: AppConfig,
  scopePath?: string,
): ResultAsync<TransactionInput | null> => {
  const scopeAbsolute = scopePath
    ? resolveSnapshotPath(scopePath, config.paths)
    : null;
  const scopeNamespace = scopeAbsolute
    ? namespaceFromSnapshotPath(scopeAbsolute, config.paths)
    : null;

  const scanNamespace = (ns: NamespaceEditable, options?: MatchOptions) => {
    if (scopeNamespace && scopeNamespace !== ns) return ok([]);
    const path = scopeAbsolute ?? snapshotRootForNamespace(ns, config.paths);
    return modifiedSnapshots(db, fs, config.paths, path, options);
  };

  const configIncludePatterns = getNavigationFilePatterns(
    CONFIG_NAVIGATION_ITEMS,
  );

  const [configResult, nodeResult] = await Promise.all([
    scanNamespace("config", { include: configIncludePatterns }),
    scanNamespace("node", { include: config.include, exclude: config.exclude }),
  ]);

  if (isErr(configResult)) return configResult;
  if (isErr(nodeResult)) return nodeResult;
  const configFiles = configResult.data;
  const nodeFiles = nodeResult.data;

  if (configFiles.length === 0 && nodeFiles.length === 0) return ok(null);

  const configSchema = kg.getConfigSchema();
  const nodeSchemaResult = await kg.getNodeSchema();
  if (isErr(nodeSchemaResult)) return nodeSchemaResult;

  const configNavigationResult = await loadNavigation(kg, "config");
  if (isErr(configNavigationResult)) return configNavigationResult;

  const nodeNavigationResult = await loadNavigation(kg, "node");
  if (isErr(nodeNavigationResult)) return nodeNavigationResult;

  const [configsResult, nodesResult] = await Promise.all([
    synchronizeNamespaceFiles(
      fs,
      kg,
      config,
      configNavigationResult.data,
      configSchema,
      configFiles,
      "config",
    ),
    synchronizeNamespaceFiles(
      fs,
      kg,
      config,
      nodeNavigationResult.data,
      nodeSchemaResult.data,
      nodeFiles,
      "node",
    ),
  ]);

  if (isErr(configsResult)) return configsResult;
  if (isErr(nodesResult)) return nodesResult;

  const configs = configsResult.data;
  const nodes = nodesResult.data;

  if (configs.length === 0 && nodes.length === 0) return ok(null);

  return ok({
    author: config.author,
    nodes,
    configurations: configs,
  });
};

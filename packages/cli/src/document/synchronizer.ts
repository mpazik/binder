import type {
  ChangesetsInput,
  EntityChangesetInput,
  EntitySchema,
  Fieldset,
  FieldsetNested,
  GraphVersion,
  Includes,
  KnowledgeGraph,
  NamespaceEditable,
  QueryParams,
  TransactionInput,
} from "@binder/db";
import { includesWithUid } from "@binder/db";
import {
  createError,
  fail,
  isEqual,
  isErr,
  ok,
  type Result,
  type ResultAsync,
} from "@binder/utils";
import { extractFieldValues } from "../utils/interpolate-fields.ts";
import { interpolateQueryParams } from "../utils/query.ts";
import { diffEntities, diffQueryResults } from "../diff";
import type { FileSystem } from "../lib/filesystem.ts";
import {
  modifiedSnapshots,
  namespaceFromSnapshotPath,
  refreshSnapshotMetadata,
  resolveSnapshotPath,
  type SnapshotChangeMetadata,
  snapshotRootForNamespace,
} from "../lib/snapshot.ts";
import type { DatabaseCli } from "../db";
import { type AppConfig } from "../config.ts";
import type { MatchOptions } from "../utils/file.ts";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  findNavigationItemByPath,
  getNavigationFilePatterns,
  getPathTemplate,
  type NavigationItem,
} from "./navigation.ts";
import {
  extract,
  type ExtractedFileData,
  type ExtractedProjection,
} from "./extraction.ts";
import { normalizeReferences, normalizeReferencesList } from "./reference.ts";
import { type Templates } from "./template-entity.ts";

const synchronizeSingle = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  entity: FieldsetNested,
  pathFields: Fieldset,
  includes?: Includes,
): ResultAsync<ChangesetsInput> => {
  const kgResult = await kg.search(
    {
      filters: pathFields as Record<string, string>,
      includes: includes ? includesWithUid(includes) : undefined,
    },
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
  log?: Logger,
): ResultAsync<ChangesetsInput> => {
  const interpolatedQuery = interpolateQueryParams(schema, query, [pathFields]);
  if (isErr(interpolatedQuery)) return interpolatedQuery;

  const kgResult = await kg.search(interpolatedQuery.data, namespace);
  if (isErr(kgResult)) return kgResult;

  log?.debug("synchronizeList", {
    query: interpolatedQuery.data,
    fileEntities: entities.map((e) => ({ uid: e.uid, milestone: e.milestone })),
    dbEntities: kgResult.data.items.map((e) => ({
      uid: e.uid,
      milestone: e.milestone,
    })),
  });

  const normalizedResult = await normalizeReferencesList(entities, schema, kg);
  if (isErr(normalizedResult)) return normalizedResult;

  const diffResult = diffQueryResults(
    schema,
    normalizedResult.data,
    kgResult.data.items,
    interpolatedQuery.data,
  );

  log?.debug("synchronizeList diffResult", {
    toCreate: diffResult.toCreate.length,
    toUpdate: diffResult.toUpdate.length,
  });

  return ok([...diffResult.toCreate, ...diffResult.toUpdate]);
};

const synchronizeProjection = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  namespace: NamespaceEditable,
  projection: ExtractedProjection,
  pathFields: Fieldset,
): ResultAsync<ChangesetsInput> => {
  const interpolatedQuery = interpolateQueryParams(schema, projection.query, [
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
  includes?: Includes,
): ResultAsync<ChangesetsInput> => {
  const kgResult = await kg.search(
    {
      filters: pathFields as Record<string, string>,
      includes: includes ? includesWithUid(includes) : undefined,
    },
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
  includes?: Includes,
  log?: Logger,
): ResultAsync<ChangesetsInput> => {
  if (data.kind === "single") {
    return synchronizeSingle(
      kg,
      schema,
      namespace,
      data.entity,
      pathFields,
      includes,
    );
  }

  if (data.kind === "list") {
    return synchronizeList(
      kg,
      schema,
      namespace,
      data.entities,
      data.query,
      pathFields,
      log,
    );
  }

  return synchronizeDocument(
    kg,
    schema,
    namespace,
    data.entity,
    data.projections,
    pathFields,
    data.includes,
  );
};

export const synchronizeFile = async <N extends NamespaceEditable>(
  fs: FileSystem,
  db: DatabaseCli,
  kg: KnowledgeGraph,
  config: AppConfig,
  version: GraphVersion,
  navigationItems: NavigationItem[],
  schema: EntitySchema,
  relativePath: string,
  namespace: N,
  templates: Templates,
  sourceContent?: string,
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

  const contentResult = sourceContent
    ? ok(sourceContent)
    : await fs.readFile(absolutePath);
  if (isErr(contentResult)) return contentResult;
  const content = contentResult.data;

  const baseResult = await kg.search(
    {
      filters: pathFields as Record<string, string>,
      includes: navItem.includes
        ? includesWithUid(navItem.includes)
        : undefined,
    },
    namespace,
  );
  const base =
    !isErr(baseResult) && baseResult.data.items.length === 1
      ? baseResult.data.items[0]!
      : {};

  const extractResult = extract(
    schema,
    navItem,
    content,
    absolutePath,
    templates,
    base,
  );
  if (isErr(extractResult)) return extractResult;

  const changesets = await synchronizeExtracted(
    kg,
    schema,
    namespace,
    extractResult.data,
    pathFields,
    navItem.includes,
  );
  if (isErr(changesets)) return changesets;

  const refreshResult = refreshSnapshotMetadata(
    db,
    fs,
    config.paths,
    absolutePath,
    content,
    version,
  );
  if (isErr(refreshResult)) return refreshResult;

  return changesets;
};

const synchronizeNamespaceFiles = async <N extends NamespaceEditable>(
  { fs, db, config, kg, nav }: RuntimeContextWithDb,
  modifiedFiles: SnapshotChangeMetadata[],
  namespace: N,
  templates: Templates,
): ResultAsync<ChangesetsInput<N>> => {
  const changesets: ChangesetsInput<N> = [];
  const navigationItemsResult = await nav(namespace);
  if (isErr(navigationItemsResult)) return navigationItemsResult;
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;

  for (const file of modifiedFiles) {
    const syncResult = await synchronizeFile(
      fs,
      db,
      kg,
      config,
      versionResult.data,
      navigationItemsResult.data,
      schemaResult.data,
      file.path,
      namespace,
      templates,
    );
    if (isErr(syncResult)) return syncResult;

    changesets.push(...syncResult.data);
  }

  return ok(changesets);
};

const detectCrossFileConflicts = <N extends NamespaceEditable>(
  changesets: ChangesetsInput<N>,
): Result<void> => {
  const byRef = new Map<string, EntityChangesetInput<N>[]>();
  for (const cs of changesets) {
    const ref = "$ref" in cs ? (cs.$ref as string) : undefined;
    if (!ref) continue;
    const group = byRef.get(ref);
    if (group) group.push(cs);
    else byRef.set(ref, [cs]);
  }

  for (const [ref, group] of byRef) {
    if (group.length < 2) continue;

    // Check all field keys across the group for conflicting values
    const fieldValues = new Map<string, unknown>();
    for (const cs of group) {
      for (const [key, value] of Object.entries(cs)) {
        if (key === "$ref" || key === "type" || key === "key") continue;
        const existing = fieldValues.get(key);
        if (existing === undefined) {
          fieldValues.set(key, value);
        } else if (!isEqual(existing, value)) {
          return fail(
            "field-conflict",
            `Conflicting values for field '${key}' on entity '${ref}' from different files`,
            {
              fieldPath: [key],
              values: [{ value: existing }, { value }],
              baseValue: null,
            },
          );
        }
      }
    }
  }

  return ok(undefined);
};

export const synchronizeModifiedFiles = async (
  runtime: RuntimeContextWithDb,
  scopePath?: string,
  log?: Logger,
): ResultAsync<TransactionInput | null> => {
  const { config, db, kg, fs } = runtime;
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

  const nodeNavigationResult = await runtime.nav("node");
  if (isErr(nodeNavigationResult)) return nodeNavigationResult;
  const nodeIncludePatterns = [
    ...getNavigationFilePatterns(nodeNavigationResult.data),
    ...(config.include ?? []),
  ];

  const [configResult, nodeResult] = await Promise.all([
    scanNamespace("config", { include: configIncludePatterns }),
    scanNamespace("node", {
      include: nodeIncludePatterns,
      exclude: config.exclude,
    }),
  ]);

  if (isErr(configResult)) return configResult;
  if (isErr(nodeResult)) return nodeResult;
  const configFiles = configResult.data;
  const nodeFiles = nodeResult.data;

  log?.debug("Modified files detected", {
    configFiles: configFiles.map((f) => ({ path: f.path, type: f.type })),
    nodeFiles: nodeFiles.map((f) => ({ path: f.path, type: f.type })),
  });

  if (configFiles.length === 0 && nodeFiles.length === 0) return ok(null);

  const templatesResult = await runtime.templates();
  if (isErr(templatesResult)) return templatesResult;
  const templates = templatesResult.data;

  const [configsResult, nodesResult] = await Promise.all([
    synchronizeNamespaceFiles(runtime, configFiles, "config", templates),
    synchronizeNamespaceFiles(runtime, nodeFiles, "node", templates),
  ]);

  if (isErr(configsResult)) return configsResult;
  if (isErr(nodesResult)) return nodesResult;

  const configs = configsResult.data;
  const nodes = nodesResult.data;

  log?.debug("Changesets after synchronization", {
    configChangesets: configs.length,
    nodeChangesets: nodes.length,
    nodeDetails: nodes.map((n) => {
      const { $ref, type, key, ...fields } = n as Record<string, unknown>;
      return {
        ref: $ref ?? key ?? type,
        fields: Object.keys(fields),
      };
    }),
  });

  if (configs.length === 0 && nodes.length === 0) return ok(null);

  const nodeConflicts = detectCrossFileConflicts(nodes);
  if (isErr(nodeConflicts)) return nodeConflicts;
  const configConflicts = detectCrossFileConflicts(configs);
  if (isErr(configConflicts)) return configConflicts;

  return ok({
    author: config.author,
    nodes,
    configurations: configs,
  });
};

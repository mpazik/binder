import {
  createError,
  err,
  groupByToObject,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { and, asc, desc, inArray, or, sql } from "drizzle-orm";
import {
  type ConfigDataType,
  type ConfigSchemaExtended,
  coreConfigSchema,
  type EntityRef,
  type EntitySchema,
  type Fieldset,
  fieldTypes,
  type Filters,
  type GraphVersion,
  type Includes,
  isFieldInSchema,
  mergeSchema,
  type NamespaceEditable,
  type NamespaceSchema,
  type NodeFieldDef,
  type NodeRef,
  type NodeSchema,
  type PaginationInfo,
  type QueryParams,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  type TransactionRef,
  type TypeDef,
  typeSystemType,
  validateAppConfigSchema,
} from "./model";
import type { Database, DbTransaction } from "./db.ts";
import { configTable, nodeTable } from "./schema.ts";
import { dbModelToEntity, fetchEntity } from "./entity-store.ts";
import { fetchTransaction, getVersion } from "./transaction-store.ts";
import {
  applyAndSaveTransaction,
  processTransactionInput,
  rollbackTransaction,
} from "./transaction-processor";
import { buildWhereClause } from "./filter-entities.ts";
import { resolveIncludes } from "./relationship-resolver.ts";

export type KnowledgeGraph<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = {
  fetchEntity: (
    ref: EntityRef,
    includes?: Includes,
    namespace?: NamespaceEditable,
  ) => ResultAsync<Fieldset>;
  fetchTransaction: (ref: TransactionRef) => ResultAsync<Transaction>;
  search: (
    query: QueryParams,
    namespace?: NamespaceEditable,
  ) => ResultAsync<{
    items: Fieldset[];
    pagination: PaginationInfo;
  }>;
  version: () => ResultAsync<GraphVersion>;
  update: (input: TransactionInput) => ResultAsync<Transaction>;
  apply: (transaction: Transaction) => ResultAsync<Transaction>;
  rollback: (count: number, version?: TransactionId) => ResultAsync<void>;
  getNodeSchema: () => ResultAsync<NodeSchema>;
  getConfigSchema: () => ConfigSchemaExtended<C>;
  getSchema: <N extends NamespaceEditable>(
    namespace: N,
  ) => ResultAsync<NamespaceSchema<N>>;
};

export type TransactionRollback = () => ResultAsync<void>;

export type KnowledgeGraphCallbacks = {
  beforeTransaction?: (
    transaction: Transaction,
  ) => ResultAsync<TransactionRollback>;
  beforeCommit?: (transaction: Transaction) => ResultAsync<void>;
  afterCommit?: (transaction: Transaction) => Promise<void>;
  afterRollback?: (transactions: Transaction[], count: number) => Promise<void>;
};

const internalSearch = async (
  tx: DbTransaction,
  namespace: NamespaceEditable,
  filters: Filters,
  schema: EntitySchema,
): ResultAsync<Fieldset[]> => {
  const table = namespace === "config" ? configTable : nodeTable;
  return tryCatch(
    tx
      .select()
      .from(table)
      .where(buildWhereClause(table, filters, schema))
      .orderBy(asc(table.id))
      .then((rows) => rows.map((row) => dbModelToEntity(row))),
  );
};

const openKnowledgeGraph = <C extends EntitySchema<ConfigDataType>>(
  db: Database,
  options?: {
    providerSchema?: NodeSchema;
    configSchema?: C;
    callbacks?: KnowledgeGraphCallbacks;
  },
): KnowledgeGraph<C> => {
  const callbacks = options?.callbacks;
  if (options?.configSchema) {
    validateAppConfigSchema(options.configSchema);
  }
  const configSchema = mergeSchema(
    coreConfigSchema,
    options?.configSchema,
  ) as ConfigSchemaExtended<C>;

  let nodeSchemaCache: NodeSchema | null = null;

  const getNodeSchema = async (): ResultAsync<NodeSchema> => {
    if (nodeSchemaCache !== null) {
      return ok(nodeSchemaCache);
    }

    return db.transaction(async (tx) => {
      const configsResult = await tryCatch(
        tx
          .select()
          .from(configTable)
          .where(or(inArray(configTable.type, [...fieldTypes, typeSystemType])))
          .then((rows) => rows.map((row) => dbModelToEntity(row))),
      );

      if (isErr(configsResult)) return configsResult;

      const fields = configsResult.data.filter((config) =>
        fieldTypes.includes(config.type as any),
      ) as unknown as NodeFieldDef[];

      const types = configsResult.data.filter(
        (config) => config.type === typeSystemType,
      ) as unknown as TypeDef[];

      const schema: NodeSchema = mergeSchema(options?.providerSchema, {
        fields: groupByToObject(fields, (f) => f.key),
        types: groupByToObject(types, (t) => t.key),
      });

      nodeSchemaCache = schema;
      return ok(schema);
    });
  };
  const getSchema = async (
    namespace: NamespaceEditable,
  ): ResultAsync<NodeSchema | ConfigSchemaExtended<C>> =>
    namespace === "config" ? ok(configSchema) : getNodeSchema();

  const applyAndNotify = async (transaction: Transaction) => {
    let rollbackBeforeHook: TransactionRollback | null = null;

    if (callbacks?.beforeTransaction) {
      const beforeResult = await callbacks.beforeTransaction(transaction);
      if (isErr(beforeResult)) return beforeResult;
      rollbackBeforeHook = beforeResult.data;
    }

    const dbResult = await db.transaction(async (tx) => {
      const applyResult = await applyAndSaveTransaction(tx, transaction);
      if (isErr(applyResult)) return applyResult;

      const hasConfigChanges =
        Object.keys(transaction.configurations).length > 0;
      if (hasConfigChanges) {
        nodeSchemaCache = null;
      }

      if (callbacks?.beforeCommit) {
        const commitResult = await callbacks.beforeCommit(transaction);
        if (isErr(commitResult)) return commitResult;
      }

      return ok(transaction);
    });

    if (isErr(dbResult)) {
      if (rollbackBeforeHook) await rollbackBeforeHook();
      return dbResult;
    }

    if (callbacks?.afterCommit) {
      await callbacks.afterCommit(transaction);
    }

    return ok(transaction);
  };

  return {
    fetchEntity: async (
      ref: NodeRef,
      includes?: Includes,
      namespace = "node",
    ) => {
      return db.transaction(async (tx) => {
        const entityResult = await fetchEntity(tx, namespace, ref as any);
        if (isErr(entityResult)) return entityResult;

        const schemaResult = await getSchema(namespace);
        if (isErr(schemaResult)) return schemaResult;

        const resolvedResult = await resolveIncludes(
          tx,
          [entityResult.data],
          includes,
          namespace,
          schemaResult.data,
          internalSearch,
        );
        if (isErr(resolvedResult)) return resolvedResult;

        return ok(resolvedResult.data[0]!);
      });
    },
    fetchTransaction: async (ref: TransactionRef) => {
      return db.transaction(async (tx) => {
        return fetchTransaction(tx, ref);
      });
    },
    search: async (
      query: QueryParams,
      namespace: "node" | "config" = "node",
    ) => {
      return db.transaction(async (tx) => {
        const { filters = {}, pagination, includes } = query;
        const limit = pagination?.limit ?? 50;
        const after = pagination?.after;
        const before = pagination?.before;

        const schemaResult = await getSchema(namespace);
        if (isErr(schemaResult)) return schemaResult;
        const schema = schemaResult.data;

        for (const fieldKey of Object.keys(filters)) {
          if (isFieldInSchema(fieldKey, schema)) continue;
          return err(
            createError(
              "invalid_filter_field",
              `Filter field '${fieldKey}' is not defined in schema`,
              { fieldKey },
            ),
          );
        }

        const table = namespace === "config" ? configTable : nodeTable;
        const filterClause = buildWhereClause(table, filters, schema);

        const orderClause = before ? desc(table.id) : asc(table.id);
        const paginationClause = after
          ? sql`${table.id} > ${parseInt(after, 10)}`
          : before
            ? sql`${table.id} < ${parseInt(before, 10)}`
            : undefined;
        const whereClause = and(filterClause, paginationClause);

        const results = await tryCatch(
          tx
            .select()
            .from(table)
            .where(whereClause)
            .orderBy(orderClause)
            .limit(limit + 1)
            .then((rows) => rows),
        );
        if (isErr(results)) return results;

        const orderedResults = before ? results.data.reverse() : results.data;
        const hasMore = orderedResults.length > limit;
        const dbItems = orderedResults
          .slice(0, limit)
          .map((row) => dbModelToEntity(row));

        const resolvedResult = await resolveIncludes(
          tx,
          dbItems,
          includes,
          namespace,
          schema,
          internalSearch,
        );
        if (isErr(resolvedResult)) return resolvedResult;
        const items = resolvedResult.data;

        const firstItem = items[0];
        const lastItem = items[items.length - 1];

        return ok({
          items,
          pagination: {
            hasNext: hasMore,
            hasPrevious: !!after,
            nextCursor: hasMore && lastItem ? String(lastItem.id) : null,
            previousCursor: firstItem && after ? String(firstItem.id) : null,
          },
        });
      });
    },
    version: async () => {
      return db.transaction(async (tx) => {
        return getVersion(tx);
      });
    },
    update: async (input: TransactionInput) => {
      return db.transaction(async (tx) => {
        const nodeSchemaResult = await getNodeSchema();
        if (isErr(nodeSchemaResult)) return nodeSchemaResult;
        const processedResult = await processTransactionInput(
          tx,
          input,
          nodeSchemaResult.data,
          configSchema,
        );

        if (isErr(processedResult)) return processedResult;

        return applyAndNotify(processedResult.data);
      });
    },
    apply: async (transaction: Transaction) => {
      return applyAndNotify(transaction);
    },
    rollback: async (count, version) => {
      const dbResult = await db.transaction(async (dbTx) => {
        const versionResult = await getVersion(dbTx);
        if (isErr(versionResult)) return versionResult;
        const txId = version ?? versionResult.data.id;

        nodeSchemaCache = null;

        return rollbackTransaction(dbTx, count, txId);
      });
      if (isErr(dbResult)) return dbResult;

      if (callbacks?.afterRollback) {
        await callbacks.afterRollback(dbResult.data, count);
      }
      return ok(undefined);
    },
    getNodeSchema,
    getConfigSchema: () => configSchema,
    getSchema: <N extends NamespaceEditable>(namespace: N) =>
      getSchema(namespace) as ResultAsync<NamespaceSchema<N>>,
  };
};
export default openKnowledgeGraph;

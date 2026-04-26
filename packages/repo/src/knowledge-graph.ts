import {
  fail,
  groupByToObject,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
  isObjectNonEmpty,
} from "@binder/utils";
import { and, asc, desc, inArray, sql } from "drizzle-orm";
import {
  type ConfigDataType,
  type ConfigSchemaExtended,
  coreConfigSchema,
  coreRecordSchema,
  type EntityRef,
  type EntitySchema,
  type Fieldset,
  fieldTypes,
  type Filters,
  type GraphVersion,
  type Includes,
  mergeSchema,
  type Namespace,
  type NamespaceEditable,
  type NamespaceSchema,
  type PaginationInfo,
  type QueryParams,
  type RecordFieldDef,
  type RecordRef,
  type RecordSchema,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  type TransactionRef,
  type TypeDef,
  typeSystemType,
  txFields,
  validateAppConfigSchema,
} from "./model";
import type { Database, DbTransaction } from "./db.ts";
import { configTable, recordTable, transactionTable } from "./schema.ts";
import { dbModelToEntity, fetchEntity } from "./entity-store.ts";
import {
  fetchTransaction,
  getVersion,
  unpackTxFields,
} from "./transaction-store.ts";
import { processTransactionInput } from "./transaction-processor";
import {
  applyAndSaveTransaction,
  rollbackTransaction,
} from "./transaction-applier";
import {
  buildOrderByClause,
  buildWhereClause,
  normalizeRelationFilters,
} from "./filter-entities.ts";
import { resolveIncludes } from "./relationship-resolver.ts";

export const DEFAULT_SEARCH_LIMIT = 50;

export type KnowledgeGraph<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = {
  fetchEntity: (
    ref: EntityRef,
    includes?: Includes,
    namespace?: NamespaceEditable,
  ) => ResultAsync<Fieldset>;
  fetchTransaction: (ref: TransactionRef) => ResultAsync<Transaction>;
  listTransactions: (opts?: {
    after?: TransactionId;
    before?: TransactionId;
    limit?: number;
    order?: "asc" | "desc";
  }) => ResultAsync<Transaction[]>;
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
  getRecordSchema: () => ResultAsync<RecordSchema>;
  getConfigSchema: () => ConfigSchemaExtended<C>;
  getSchema: <N extends Namespace>(
    namespace: N,
  ) => ResultAsync<NamespaceSchema<N>>;
  onTransaction: (
    filter: TransactionFilter | undefined,
    handler: TransactionHandler,
  ) => Unsubscribe;
};

export type TransactionFilter = (tx: Transaction) => boolean;
export type TransactionHandler = (tx: Transaction) => void | Promise<void>;
export type Unsubscribe = () => void;

export type ReadonlyKnowledgeGraph<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = Omit<KnowledgeGraph<C>, "update" | "apply" | "rollback">;

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
  const normalizedFiltersResult = await normalizeRelationFilters(
    tx,
    namespace,
    filters,
    schema,
  );
  if (isErr(normalizedFiltersResult)) return normalizedFiltersResult;

  const table = namespace === "config" ? configTable : recordTable;
  return tryCatch(
    tx
      .select()
      .from(table)
      .where(buildWhereClause(table, normalizedFiltersResult.data, schema))
      .orderBy(asc(table.id))
      .then((rows) => rows.map(dbModelToEntity)),
  );
};

export const openKnowledgeGraph = <C extends EntitySchema<ConfigDataType>>(
  db: Database,
  options?: {
    providerSchema?: RecordSchema;
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

  let recordSchemaCache: RecordSchema | null = null;

  const getRecordSchema = async (): ResultAsync<RecordSchema> => {
    if (recordSchemaCache !== null) return ok(recordSchemaCache);

    return db.transaction(async (tx) => {
      const configsResult = await tryCatch(
        tx
          .select()
          .from(configTable)
          .where(inArray(configTable.type, [...fieldTypes, typeSystemType]))
          .then((rows) => rows.map(dbModelToEntity)),
      );

      if (isErr(configsResult)) return configsResult;

      const fields = configsResult.data.filter((config) =>
        fieldTypes.includes(config.type as any),
      ) as unknown as RecordFieldDef[];

      const types = configsResult.data.filter(
        (config) => config.type === typeSystemType,
      ) as unknown as TypeDef[];

      const schema: RecordSchema = mergeSchema(
        mergeSchema(coreRecordSchema(), options?.providerSchema),
        {
          fields: groupByToObject(fields, (f) => f.key),
          types: groupByToObject(types, (t) => t.key),
        },
      );

      recordSchemaCache = schema;
      return ok(schema);
    });
  };
  const getSchema = async <N extends Namespace>(
    namespace: N,
  ): ResultAsync<NamespaceSchema<N>> => {
    if (namespace === "transaction") {
      return ok({ fields: txFields, types: {} } as NamespaceSchema<N>);
    }
    if (namespace === "config") {
      return ok(configSchema as NamespaceSchema<N>);
    }
    const result = await getRecordSchema();
    if (isErr(result)) return result;
    return ok(result.data as NamespaceSchema<N>);
  };

  const transactionHandlers: {
    filter: TransactionFilter | undefined;
    handler: TransactionHandler;
  }[] = [];

  const notifyHandlers = async (transaction: Transaction) => {
    for (const { filter, handler } of transactionHandlers) {
      if (filter !== undefined && !filter(transaction)) continue;
      const result = await tryCatch(() => handler(transaction));
      if (isErr(result)) {
        console.error("Transaction handler error:", result.error);
      }
    }
  };

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

      if (isObjectNonEmpty(transaction.configs)) {
        recordSchemaCache = null;
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

    await notifyHandlers(transaction);

    return ok(transaction);
  };

  return {
    fetchEntity: async (
      ref: RecordRef,
      includes?: Includes,
      namespace = "record",
    ) =>
      db.transaction(async (tx) => {
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
      }),
    fetchTransaction: (ref: TransactionRef) =>
      db.transaction((tx) => fetchTransaction(tx, ref)),
    listTransactions: (opts) =>
      db.transaction(async (tx) => {
        const limit = opts?.limit ?? 50;
        const order =
          opts?.order === "asc"
            ? asc(transactionTable.id)
            : desc(transactionTable.id);
        const after = opts?.after
          ? sql`${transactionTable.id} > ${opts.after}`
          : undefined;
        const before = opts?.before
          ? sql`${transactionTable.id} < ${opts.before}`
          : undefined;
        const where = and(after, before);

        return tryCatch(
          tx
            .select()
            .from(transactionTable)
            .where(where)
            .orderBy(order)
            .limit(limit)
            .then((rows) =>
              rows.map((row) => ({
                id: row.id,
                hash: row.hash,
                previous: row.previous,
                records: row.records,
                configs: row.configs,
                author: row.author ?? undefined,
                createdAt: row.createdAt,
                tags: row.tags,
                ...unpackTxFields(row.fields as Record<string, unknown>),
              })),
            ),
        );
      }),
    search: async (
      query: QueryParams,
      namespace: "record" | "config" = "record",
    ) =>
      db.transaction(async (tx) => {
        const { filters = {}, pagination, includes, orderBy } = query;
        const limit = pagination?.limit ?? DEFAULT_SEARCH_LIMIT;
        const after = pagination?.after;
        const before = pagination?.before;

        const schemaResult = await getSchema(namespace);
        if (isErr(schemaResult)) return schemaResult;
        const schema = schemaResult.data;

        for (const fieldKey of Object.keys(filters)) {
          if (fieldKey === "$text") continue;
          if (fieldKey in schema.fields) continue;
          return fail(
            "invalid_filter_field",
            `Filter field '${fieldKey}' is not defined in schema`,
            { data: { fieldKey } },
          );
        }

        const normalizedFiltersResult = await normalizeRelationFilters(
          tx,
          namespace,
          filters,
          schema,
        );
        if (isErr(normalizedFiltersResult)) return normalizedFiltersResult;

        const table = namespace === "config" ? configTable : recordTable;
        const filterClause = buildWhereClause(
          table,
          normalizedFiltersResult.data,
          schema,
        );

        const orderClauses =
          orderBy && orderBy.length > 0
            ? buildOrderByClause(table, orderBy)
            : [before ? desc(table.id) : asc(table.id)];
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
            .orderBy(...orderClauses)
            .limit(limit + 1)
            .then((rows) => rows),
        );
        if (isErr(results)) return results;

        const orderedResults = before ? results.data.reverse() : results.data;
        const hasMore = orderedResults.length > limit;
        const dbItems = orderedResults.slice(0, limit).map(dbModelToEntity);

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
      }),
    version: () => db.transaction((tx) => getVersion(tx)),
    update: async (input: TransactionInput) =>
      db.transaction(async (tx) => {
        const recordSchemaResult = await getRecordSchema();
        if (isErr(recordSchemaResult)) return recordSchemaResult;

        const processedResult = await processTransactionInput(
          tx,
          input,
          recordSchemaResult.data,
          configSchema,
        );
        if (isErr(processedResult)) return processedResult;

        return applyAndNotify(processedResult.data);
      }),
    apply: (transaction: Transaction) => applyAndNotify(transaction),
    rollback: async (count, version) => {
      const dbResult = await db.transaction(async (dbTx) => {
        const versionResult = await getVersion(dbTx);
        if (isErr(versionResult)) return versionResult;
        const txId = version ?? versionResult.data.id;

        recordSchemaCache = null;

        return rollbackTransaction(dbTx, count, txId);
      });
      if (isErr(dbResult)) return dbResult;

      if (callbacks?.afterRollback) {
        await callbacks.afterRollback(dbResult.data, count);
      }
      return ok(undefined);
    },
    getRecordSchema,
    getConfigSchema: () => configSchema,
    getSchema: <N extends Namespace>(namespace: N) => getSchema(namespace),
    onTransaction: (filter, handler) => {
      const entry = { filter, handler };
      transactionHandlers.push(entry);
      return () => {
        const idx = transactionHandlers.indexOf(entry);
        if (idx !== -1) transactionHandlers.splice(idx, 1);
      };
    },
  };
};

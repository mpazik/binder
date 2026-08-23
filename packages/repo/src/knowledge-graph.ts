import {
  type ErrorObject,
  fail,
  groupByToObject,
  includes,
  isErr,
  ok,
  okVoid,
  type Result,
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
  /** Resolve and validate an input into a transaction without persisting it. */
  process: (input: TransactionInput) => ResultAsync<Transaction>;
  apply: (transaction: Transaction) => ResultAsync<Transaction>;
  rollback: (count: number, version?: TransactionId) => ResultAsync<void>;
  getRecordSchema: () => ResultAsync<RecordSchema>;
  getConfigSchema: () => ConfigSchemaExtended<C>;
  getSchema: <N extends Namespace>(
    namespace: N,
  ) => ResultAsync<NamespaceSchema<N>>;
  /**
   * Subscribes to every transaction this instance observes, regardless of
   * origin. Handlers fire after the `afterCommit` callback. Use for
   * reactions (hooks, cache refresh), not for writer side effects.
   */
  onTransaction: (
    filter: TransactionFilter | undefined,
    handler: TransactionHandler,
    name?: string,
  ) => Unsubscribe;
  /**
   * Subscribes to transactions originated by this process — committed via
   * `update()` or applied via `apply()`. Handlers fire after the database
   * commit and before the `afterCommit` callback. A process that merely
   * observes a transaction never fires `onCommit`; use `onTransaction` for
   * that. Use for writer side effects that must run exactly once (e.g.
   * mirroring each commit to an append-only log). Handler failures are
   * reported via `onSubscriberError` and never abort the commit.
   */
  onCommit: (
    filter: TransactionFilter | undefined,
    handler: TransactionHandler,
    name?: string,
  ) => Unsubscribe;
  /**
   * Subscribes to rollbacks originated by this process via `rollback()`.
   * Handlers fire after the database rollback commits and before the
   * `afterRollback` callback, receiving the reverted transactions
   * (newest-first) and the count. Mirrors `onCommit` for writer side effects
   * that must undo their commit-time work (e.g. trimming that log). Handler
   * failures are reported via `onSubscriberError` and never abort the
   * rollback.
   */
  onRollback: (
    filter: RollbackFilter | undefined,
    handler: RollbackHandler,
    name?: string,
  ) => Unsubscribe;
};

export type TransactionFilter = (tx: Transaction) => boolean;
export type RollbackFilter = (
  transactions: Transaction[],
  count: number,
) => boolean;
/** May report failure by returning an `Err` result; thrown errors are caught too. */
export type TransactionHandler = (
  tx: Transaction,
) => void | Result<unknown> | Promise<void | Result<unknown>>;
/** Batch handler for a rollback. May report failure like {@link TransactionHandler}. */
export type RollbackHandler = (
  transactions: Transaction[],
  count: number,
) => void | Result<unknown> | Promise<void | Result<unknown>>;
export type Unsubscribe = () => void;

export type SubscriberErrorContext = {
  event: "commit" | "transaction" | "rollback";
  transactionId: TransactionId;
  /** Subscriber name passed at registration, when provided. */
  subscriber?: string;
};
export type SubscriberErrorReporter = (
  error: ErrorObject,
  context: SubscriberErrorContext,
) => void;

export type ReadonlyKnowledgeGraph<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = Omit<
  KnowledgeGraph<C>,
  "update" | "apply" | "rollback" | "onCommit" | "onRollback"
>;

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
    /** Receives subscription handler failures. Defaults to `console.error`. */
    onSubscriberError?: SubscriberErrorReporter;
    /**
     * Default provenance stamped on transactions originated through `update()`
     * and `process()` when the input omits `source`. An explicit per-input
     * `source` always wins. `apply()` is never affected — a replayed
     * transaction keeps its own source.
     */
    source?: string;
  },
): KnowledgeGraph<C> => {
  const callbacks = options?.callbacks;
  const defaultSource = options?.source;

  // Stamp the kg's default source onto an input that does not specify one.
  const withDefaultSource = (input: TransactionInput): TransactionInput =>
    defaultSource === undefined || input.source !== undefined
      ? input
      : { ...input, source: defaultSource };
  if (options?.configSchema) {
    validateAppConfigSchema(options.configSchema);
  }
  const configSchema = mergeSchema(
    coreConfigSchema,
    options?.configSchema,
  ) as ConfigSchemaExtended<C>;

  let recordSchemaCache: RecordSchema | null = null;

  const loadRecordSchema = async (
    tx: DbTransaction,
  ): ResultAsync<RecordSchema> => {
    const configsResult = await tryCatch(
      tx
        .select()
        .from(configTable)
        .where(inArray(configTable.type, [...fieldTypes, typeSystemType]))
        .then((rows) => rows.map(dbModelToEntity)),
    );

    if (isErr(configsResult)) return configsResult;

    const fields = configsResult.data.filter((config) =>
      includes(fieldTypes, config.type),
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
  };

  const getRecordSchema = async (): ResultAsync<RecordSchema> => {
    if (recordSchemaCache !== null) return ok(recordSchemaCache);
    return db.transaction(loadRecordSchema);
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

  type SubscriberEntry = {
    filter: TransactionFilter | undefined;
    handler: TransactionHandler;
    name?: string;
  };

  type RollbackSubscriberEntry = {
    filter: RollbackFilter | undefined;
    handler: RollbackHandler;
    name?: string;
  };

  const commitHandlers: SubscriberEntry[] = [];
  const transactionHandlers: SubscriberEntry[] = [];
  const rollbackHandlers: RollbackSubscriberEntry[] = [];

  const reportSubscriberError: SubscriberErrorReporter =
    options?.onSubscriberError ??
    ((error, context) => {
      const subscriber =
        context.subscriber !== undefined ? ` [${context.subscriber}]` : "";
      console.error(
        `Subscriber error (${context.event}${subscriber}) for transaction ${context.transactionId}:`,
        error,
      );
    });

  const notifyHandlers = async (
    handlers: SubscriberEntry[],
    event: SubscriberErrorContext["event"],
    transaction: Transaction,
  ) => {
    for (const { filter, handler, name } of handlers) {
      if (filter !== undefined && !filter(transaction)) continue;
      const outcome = await tryCatch(async () => handler(transaction));
      const result = isErr(outcome) ? outcome : outcome.data;
      if (result !== undefined && isErr(result)) {
        reportSubscriberError(result.error, {
          event,
          transactionId: transaction.id,
          ...(name !== undefined && { subscriber: name }),
        });
      }
    }
  };

  const notifyRollbackHandlers = async (
    transactions: Transaction[],
    count: number,
  ) => {
    const transactionId = transactions[0]?.id ?? (0 as TransactionId);
    for (const { filter, handler, name } of rollbackHandlers) {
      if (filter !== undefined && !filter(transactions, count)) continue;
      const outcome = await tryCatch(async () => handler(transactions, count));
      const result = isErr(outcome) ? outcome : outcome.data;
      if (result !== undefined && isErr(result)) {
        reportSubscriberError(result.error, {
          event: "rollback",
          transactionId,
          ...(name !== undefined && { subscriber: name }),
        });
      }
    }
  };

  const subscribeRollback = (
    filter: RollbackFilter | undefined,
    handler: RollbackHandler,
    name?: string,
  ): Unsubscribe => {
    const entry = { filter, handler, name };
    rollbackHandlers.push(entry);
    return () => {
      const idx = rollbackHandlers.indexOf(entry);
      if (idx !== -1) rollbackHandlers.splice(idx, 1);
    };
  };

  const subscribe =
    (handlers: SubscriberEntry[]) =>
    (
      filter: TransactionFilter | undefined,
      handler: TransactionHandler,
      name?: string,
    ): Unsubscribe => {
      const entry = { filter, handler, name };
      handlers.push(entry);
      return () => {
        const idx = handlers.indexOf(entry);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    };

  const prepareApplyAndNotify = async (
    prepare: (
      tx: DbTransaction,
    ) => Result<Transaction> | ResultAsync<Transaction>,
  ): ResultAsync<Transaction> => {
    const beforeHookState: { rollback: TransactionRollback | null } = {
      rollback: null,
    };

    const transactionOutcome = await tryCatch(
      db.transaction(
        async (tx) => {
          const transactionResult = await prepare(tx);
          if (isErr(transactionResult)) return transactionResult;
          const transaction = transactionResult.data;

          if (callbacks?.beforeTransaction) {
            const beforeResult = await callbacks.beforeTransaction(transaction);
            if (isErr(beforeResult)) return beforeResult;
            beforeHookState.rollback = beforeResult.data;
          }

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
        },
        { behavior: "immediate" },
      ),
    );

    const dbResult = isErr(transactionOutcome)
      ? transactionOutcome
      : transactionOutcome.data;
    if (isErr(dbResult)) {
      if (beforeHookState.rollback) await beforeHookState.rollback();
      return dbResult;
    }
    const transaction = dbResult.data;

    await notifyHandlers(commitHandlers, "commit", transaction);

    if (callbacks?.afterCommit) {
      await callbacks.afterCommit(transaction);
    }

    await notifyHandlers(transactionHandlers, "transaction", transaction);

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
            // converts the drizzle thenable into a real Promise for tryCatch
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
    update: (input: TransactionInput) =>
      prepareApplyAndNotify(async (tx) => {
        // Always reload inside the reserved write transaction. A cached schema
        // may be stale after another process commits config changes.
        const recordSchemaResult = await loadRecordSchema(tx);
        if (isErr(recordSchemaResult)) return recordSchemaResult;

        return processTransactionInput(
          tx,
          withDefaultSource(input),
          recordSchemaResult.data,
          configSchema,
        );
      }),
    process: async (input: TransactionInput) =>
      db.transaction(async (tx) => {
        const recordSchemaResult = await getRecordSchema();
        if (isErr(recordSchemaResult)) return recordSchemaResult;
        return processTransactionInput(
          tx,
          withDefaultSource(input),
          recordSchemaResult.data,
          configSchema,
        );
      }),
    apply: (transaction: Transaction) =>
      prepareApplyAndNotify(() => ok(transaction)),
    rollback: async (count, version) => {
      const dbResult = await db.transaction(
        async (dbTx) => {
          const versionResult = await getVersion(dbTx);
          if (isErr(versionResult)) return versionResult;
          const txId = version ?? versionResult.data.id;

          recordSchemaCache = null;

          return rollbackTransaction(dbTx, count, txId);
        },
        { behavior: "immediate" },
      );
      if (isErr(dbResult)) return dbResult;

      await notifyRollbackHandlers(dbResult.data, count);

      if (callbacks?.afterRollback) {
        await callbacks.afterRollback(dbResult.data, count);
      }
      return okVoid;
    },
    getRecordSchema,
    getConfigSchema: () => configSchema,
    getSchema,
    onTransaction: subscribe(transactionHandlers),
    onCommit: subscribe(commitHandlers),
    onRollback: subscribeRollback,
  };
};

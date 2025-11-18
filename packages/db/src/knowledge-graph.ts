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
  configSchema,
  type ConfigRef,
  type ConfigSchema,
  type ConfigUid,
  fieldNodeTypes,
  type Fieldset,
  type GraphVersion,
  isFieldInSchema,
  type NamespaceEditable,
  type NodeFieldDefinition,
  type NodeRef,
  type NodeSchema,
  type NodeTypeDefinition,
  type PaginationInfo,
  type QueryParams,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  type TransactionRef,
  typeConfigType,
} from "./model";
import type { Database } from "./db.ts";
import { configTable, nodeTable } from "./schema.ts";
import {
  dbModelToEntity,
  fetchEntity,
  resolveEntityRefs,
} from "./entity-store.ts";
import { fetchTransaction, getVersion } from "./transaction-store.ts";
import {
  applyAndSaveTransaction,
  processTransactionInput,
  rollbackTransaction,
} from "./transaction-processor";
import { buildWhereClause } from "./filter-entities.ts";

export type KnowledgeGraph = {
  fetchNode: (ref: NodeRef) => ResultAsync<Fieldset>;
  fetchConfig: (ref: ConfigRef) => ResultAsync<Fieldset>;
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

export const openKnowledgeGraph = (
  db: Database,
  callbacks?: KnowledgeGraphCallbacks,
): KnowledgeGraph => {
  let nodeSchemaCache: NodeSchema | null = null;

  const getNodeSchema = async () => {
    if (nodeSchemaCache !== null) {
      return ok(nodeSchemaCache);
    }

    return db.transaction(async (tx) => {
      const configsResult = await tryCatch(
        tx
          .select()
          .from(configTable)
          .where(
            or(inArray(configTable.type, [...fieldNodeTypes, typeConfigType])),
          )
          .then((rows) => rows.map((row) => dbModelToEntity(row))),
      );

      if (isErr(configsResult)) return configsResult;

      const fields = configsResult.data.filter((config) =>
        fieldNodeTypes.includes(config.type as any),
      ) as unknown as NodeFieldDefinition[];

      const types = configsResult.data.filter(
        (config) => config.type === typeConfigType,
      ) as unknown as NodeTypeDefinition[];

      const schema: NodeSchema = {
        fields: groupByToObject(fields, (f) => f.key),
        types: groupByToObject(types, (t) => t.key),
      };

      nodeSchemaCache = schema;

      return ok(schema);
    });
  };
  const getSchema = async (
    namespace: NamespaceEditable,
  ): ResultAsync<NodeSchema | ConfigSchema> => {
    return namespace === "config" ? ok(configSchema) : getNodeSchema();
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

    if (callbacks?.afterCommit)
      callbacks.afterCommit(transaction).catch(() => {});

    return ok(transaction);
  };

  return {
    fetchNode: async (ref: NodeRef) => {
      return db.transaction(async (tx) => {
        return fetchEntity(tx, "node", ref);
      });
    },
    fetchConfig: async (ref: ConfigRef) => {
      return db.transaction(async (tx) => {
        const resolvedRefs = await resolveEntityRefs(tx, "config", [ref]);
        if (isErr(resolvedRefs)) return resolvedRefs;
        const configUid = resolvedRefs.data[0] as ConfigUid;

        return fetchEntity(tx, "config", configUid);
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
        const { filters = {}, pagination } = query;
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
        const filterClause = buildWhereClause(table, filters);

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
        const items = orderedResults
          .slice(0, limit)
          .map((row) => dbModelToEntity(row));

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
        callbacks.afterRollback(dbResult.data, count).catch(() => {});
      }
      return ok(undefined);
    },
    getNodeSchema,
  };
};

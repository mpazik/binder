import {
  errorToObject,
  isErr,
  notImplementedError,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { and, asc, desc, sql } from "drizzle-orm";
import type {
  ConfigRef,
  ConfigUid,
  Fieldset,
  GraphVersion,
  NodeRef,
  NodeUid,
  Transaction,
  TransactionInput,
  TransactionRef,
  PaginationInfo,
  QueryParams,
} from "./model";
import type { Database } from "./db.ts";
import { nodeTable } from "./schema.ts";
import {
  dbModelToEntity,
  fetchEntity,
  resolveEntityRefs,
} from "./entity-store.ts";
import { fetchTransaction, getVersion } from "./transaction-store.ts";
import {
  applyTransaction,
  processTransactionInput,
} from "./transaction-processor";
import { buildWhereClause } from "./filter-entities.ts";

export type KnowledgeGraph = {
  fetchNode: (ref: NodeRef) => ResultAsync<Fieldset>;
  fetchConfig: (ref: ConfigRef) => ResultAsync<Fieldset>;
  fetchTransaction: (ref: TransactionRef) => ResultAsync<Transaction>;
  version: () => ResultAsync<GraphVersion>;
  update: (input: TransactionInput) => ResultAsync<Transaction>;
  search: (query: QueryParams) => ResultAsync<{
    items: Fieldset[];
    pagination: PaginationInfo;
  }>;
  rollback: (
    tx: TransactionRef,
    opt?: {
      maxDepth: number;
    },
  ) => ResultAsync<void>;
  revert: (
    tx: TransactionRef,
    opt?: {
      force: boolean;
      permanent: boolean;
    },
  ) => ResultAsync<void>;
};

export const openKnowledgeGraph = (db: Database): KnowledgeGraph => {
  return {
    fetchNode: async (ref: NodeRef) => {
      return db.transaction(async (tx) => {
        const resolvedRefs = await resolveEntityRefs(tx, "node", [ref]);
        if (isErr(resolvedRefs)) return resolvedRefs;
        const nodeUid = resolvedRefs.data[0] as NodeUid;

        return fetchEntity(tx, "node", nodeUid);
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
    update: async (input: TransactionInput) => {
      return db.transaction(async (tx) => {
        const processedResult = await processTransactionInput(tx, input);
        if (isErr(processedResult)) return processedResult;

        const applyResult = await applyTransaction(tx, processedResult.data);
        if (isErr(applyResult)) return applyResult;

        return ok(processedResult.data);
      });
    },
    version: async () => {
      return db.transaction(async (tx) => {
        return getVersion(tx);
      });
    },
    search: async (query: QueryParams) => {
      return db.transaction(async (tx) => {
        const { filters, pagination } = query;
        const limit = pagination?.limit ?? 50;
        const after = pagination?.after;
        const before = pagination?.before;

        const filterClause = buildWhereClause(nodeTable, filters);
        const deletedClause = sql`${nodeTable.deletedAt} IS NULL`;

        let whereClause = filterClause
          ? and(filterClause, deletedClause)
          : deletedClause;

        const orderClause = before ? desc(nodeTable.id) : asc(nodeTable.id);
        const paginationClause = after
          ? sql`${nodeTable.id} > ${parseInt(after, 10)}`
          : before
            ? sql`${nodeTable.id} < ${parseInt(before, 10)}`
            : undefined;
        whereClause = and(whereClause, paginationClause);

        const results = await tryCatch(
          tx
            .select()
            .from(nodeTable)
            .where(whereClause)
            .orderBy(orderClause)
            .limit(limit + 1)
            .then((rows) => rows),
          errorToObject,
        );
        if (isErr(results)) return results;

        const orderedResults = before ? results.data.reverse() : results.data;
        const hasMore = orderedResults.length > limit;
        const items = orderedResults.slice(0, limit).map((row) =>
          dbModelToEntity({
            ...row,
            deletedAt: row.deletedAt ?? undefined,
          }),
        );

        const firstItem = items[0];
        const lastItem = items[items.length - 1];

        const nextCursor = hasMore && lastItem ? String(lastItem.id) : null;
        const previousCursor = firstItem && after ? String(firstItem.id) : null;

        let hasPrevious = false;
        if (after && firstItem) {
          const baseWhereClause = filterClause
            ? and(filterClause, deletedClause)
            : deletedClause;
          const prevCheck = await tryCatch(
            tx
              .select({ id: nodeTable.id })
              .from(nodeTable)
              .where(
                and(baseWhereClause, sql`${nodeTable.id} < ${firstItem.id}`),
              )
              .limit(1)
              .then((rows) => rows),
            errorToObject,
          );
          if (isErr(prevCheck)) return prevCheck;
          hasPrevious = prevCheck.data.length > 0;
        }

        return ok({
          items,
          pagination: {
            hasNext: hasMore,
            hasPrevious,
            nextCursor,
            previousCursor,
          },
        });
      });
    },
    rollback: async (tx: TransactionRef, opt?) =>
      notImplementedError("rollback"),
    revert: async (tx: TransactionRef, opt?) => notImplementedError("revert"),
  };
};

import {
  assertNotEmpty,
  errorToObject,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { desc, eq } from "drizzle-orm";
import {
  GENESIS_VERSION,
  type GraphVersion,
  isTransactionId,
  type Transaction,
  type TransactionRef,
} from "./model";
import type { DbTransaction } from "./db.ts";
import { transactionTable } from "./schema.ts";

export const getVersion = async (
  tx: DbTransaction,
): ResultAsync<GraphVersion> => {
  return tryCatch(
    tx
      .select({
        id: transactionTable.id,
        hash: transactionTable.hash,
        updatedAt: transactionTable.createdAt,
      })
      .from(transactionTable)
      .orderBy(desc(transactionTable.id))
      .limit(1)
      .then((result) => {
        if (result.length === 0) {
          return GENESIS_VERSION;
        }
        return result[0];
      }),
    errorToObject,
  );
};

export const fetchTransaction = async (
  tx: DbTransaction,
  ref: TransactionRef,
): ResultAsync<Transaction> => {
  return tryCatch(
    tx
      .select()
      .from(transactionTable)
      .where(
        isTransactionId(ref)
          ? eq(transactionTable.id, ref)
          : eq(transactionTable.hash, ref),
      )
      .limit(1)
      .then((result) => {
        assertNotEmpty(result);
        const row = result[0];
        return {
          id: row.id,
          hash: row.hash,
          previous: row.previous,
          nodes: row.nodes,
          configurations: row.configurations,
          author: row.author ?? undefined,
          createdAt: row.createdAt,
        };
      }),
    errorToObject,
  );
};

export const saveTransaction = async (
  tx: DbTransaction,
  transaction: Transaction,
): ResultAsync<void> => {
  return tryCatch(
    async () =>
      await tx.insert(transactionTable).values({
        id: transaction.id,
        hash: transaction.hash,
        previous: transaction.previous,
        nodes: transaction.nodes,
        configurations: transaction.configurations,
        author: transaction.author,
        fields: {},
        createdAt: transaction.createdAt,
      }),
    errorToObject,
  );
};

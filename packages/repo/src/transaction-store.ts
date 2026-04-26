import { assertNotEmpty, type ResultAsync, tryCatch } from "@binder/utils";
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

const pickDefined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

/** Extract transaction metadata fields (message, source, channel) from the JSON `fields` column. */
export const unpackTxFields = (
  fields: Record<string, unknown>,
): Pick<Transaction, "message" | "source" | "channel"> => ({
  message: typeof fields.message === "string" ? fields.message : undefined,
  source: typeof fields.source === "string" ? fields.source : undefined,
  channel: typeof fields.channel === "string" ? fields.channel : undefined,
});

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
          records: row.records,
          configs: row.configs,
          author: row.author ?? undefined,
          createdAt: row.createdAt,
          tags: row.tags,
          ...unpackTxFields(row.fields as Record<string, unknown>),
        };
      }),
  );
};

export const saveTransaction = async (
  tx: DbTransaction,
  transaction: Transaction,
): ResultAsync<void> => {
  const fields = pickDefined({
    message: transaction.message,
    source: transaction.source,
    channel: transaction.channel,
  });
  return tryCatch(
    async () =>
      await tx.insert(transactionTable).values({
        id: transaction.id,
        hash: transaction.hash,
        previous: transaction.previous,
        records: transaction.records,
        configs: transaction.configs,
        author: transaction.author,
        fields: Object.keys(fields).length > 0 ? fields : {},
        tags: transaction.tags,
        createdAt: transaction.createdAt,
      }),
  );
};

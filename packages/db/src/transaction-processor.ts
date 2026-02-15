import {
  createError,
  err,
  isErr,
  newIsoTimestamp,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { and, desc, gte, lte } from "drizzle-orm";
import {
  type ChangesetsInput,
  type ConfigUid,
  type FieldChangeset,
  incrementEntityId,
  type RecordSchema,
  type RecordUid,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  invertTransaction,
  withHashTransaction,
  type ConfigSchema,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  applyChangeset,
  applyConfigChangesetToSchema,
  processChangesetInput,
} from "./changeset-processor";
import { getVersion, saveTransaction } from "./transaction-store";
import { getLastEntityId } from "./entity-store";
import { transactionTable } from "./schema.ts";

export const processTransactionInput = async (
  tx: DbTransaction,
  input: TransactionInput,
  recordSchema: RecordSchema,
  configSchema: ConfigSchema,
): ResultAsync<Transaction> => {
  const createdAt = input.createdAt ?? newIsoTimestamp();

  const [lastRecordIdResult, lastConfigIdResult, versionResult] =
    await Promise.all([
      getLastEntityId(tx, "record"),
      getLastEntityId(tx, "config"),
      getVersion(tx),
    ]);
  if (isErr(lastRecordIdResult)) return lastRecordIdResult;
  if (isErr(lastConfigIdResult)) return lastConfigIdResult;
  if (isErr(versionResult)) return versionResult;

  const configsResult = await processChangesetInput(
    tx,
    "config",
    (input.configs ?? []) as ChangesetsInput,
    configSchema,
    lastConfigIdResult.data,
  );

  if (isErr(configsResult)) return configsResult;
  const configs = configsResult.data;

  const recordsResult = await processChangesetInput(
    tx,
    "record",
    (input.records ?? []) as ChangesetsInput,
    applyConfigChangesetToSchema(recordSchema, configsResult.data),
    lastRecordIdResult.data,
  );
  if (isErr(recordsResult)) return recordsResult;

  const updatedSchema = applyConfigChangesetToSchema(
    recordSchema,
    configsResult.data,
  );

  return ok(
    await withHashTransaction(
      configSchema,
      updatedSchema,
      {
        previous: versionResult.data.hash,
        author: input.author ?? "",
        createdAt,
        records: recordsResult.data,
        configs: configs,
      },
      incrementEntityId(versionResult.data.id),
    ),
  );
};

const addTxIdsToChangeset = (
  changeset: FieldChangeset,
  txId: TransactionId,
  kind: "insert" | "remove",
): FieldChangeset => ({
  ...changeset,
  txIds: ["seq", [kind === "insert" ? ["insert", txId] : ["remove", txId]]],
});

export const applyTransaction = async (
  tx: DbTransaction,
  transaction: Transaction,
): ResultAsync<void> => {
  const recordEntries = Object.entries(transaction.records);
  const configEntries = Object.entries(transaction.configs);

  for (const [entityUid, changeset] of configEntries) {
    const result = await applyChangeset(
      tx,
      "config",
      entityUid as ConfigUid,
      addTxIdsToChangeset(changeset, transaction.id, "insert"),
    );
    if (isErr(result)) return result;
  }

  for (const [entityUid, changeset] of recordEntries) {
    const result = await applyChangeset(
      tx,
      "record",
      entityUid as RecordUid,
      addTxIdsToChangeset(changeset, transaction.id, "insert"),
    );
    if (isErr(result)) return result;
  }

  return ok(undefined);
};

export const applyAndSaveTransaction = async (
  tx: DbTransaction,
  transaction: Transaction,
): ResultAsync<void> => {
  const applyResult = await applyTransaction(tx, transaction);
  if (isErr(applyResult)) return applyResult;
  return saveTransaction(tx, transaction);
};

export const rollbackTransaction = async (
  tx: DbTransaction,
  count: number,
  version: TransactionId,
): ResultAsync<Transaction[]> => {
  if (count < 1)
    return err(
      createError("invalid-rollback", `Count must be at least 1, got ${count}`),
    );

  const versionResult = await getVersion(tx);
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;

  if (currentId !== version)
    return err(
      createError(
        "version-mismatch",
        `Repository version mismatch: expected ${version}, got ${currentId}`,
      ),
    );

  if (count > currentId)
    return err(
      createError(
        "invalid-rollback",
        `Cannot rollback ${count} transactions, only ${currentId} available`,
      ),
    );

  const targetId = (currentId - count + 1) as TransactionId;

  const transactionsToRevertResult = await tryCatch(
    tx
      .select()
      .from(transactionTable)
      .where(
        and(
          gte(transactionTable.id, targetId),
          lte(transactionTable.id, currentId),
        ),
      )
      .orderBy(desc(transactionTable.id))
      .then((rows) => rows),
  );
  if (isErr(transactionsToRevertResult)) return transactionsToRevertResult;

  const transactionsToRevert: Transaction[] = transactionsToRevertResult.data;

  for (const transaction of transactionsToRevert) {
    const inverted = invertTransaction(transaction);
    const result = await applyTransaction(tx, inverted);
    if (isErr(result)) return result;
  }

  const deleteTransactionsResult = await tryCatch(
    tx
      .delete(transactionTable)
      .where(
        and(
          gte(transactionTable.id, targetId),
          lte(transactionTable.id, currentId),
        ),
      )
      .then(() => undefined),
  );
  if (isErr(deleteTransactionsResult)) return deleteTransactionsResult;

  return ok(transactionsToRevert);
};

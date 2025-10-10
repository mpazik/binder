import {
  createError,
  err,
  errorToObject,
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
  hashTransaction,
  incrementEntityId,
  inverseChangeset,
  type NodeUid,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  transactionToCanonical,
} from "./model";
import type { DbTransaction } from "./db.ts";
import { applyChangeset, processChangesetInput } from "./changeset-processor";
import { getVersion, saveTransaction } from "./transaction-store";
import { getLastEntityId } from "./entity-store";
import { transactionTable } from "./schema.ts";

export const processTransactionInput = async (
  tx: DbTransaction,
  input: TransactionInput,
): ResultAsync<Transaction> => {
  const createdAt = input.createdAt ?? newIsoTimestamp();

  const [lastNodeIdResult, lastConfigIdResult] = await Promise.all([
    getLastEntityId(tx, "node"),
    getLastEntityId(tx, "config"),
  ]);
  if (isErr(lastNodeIdResult)) return lastNodeIdResult;
  if (isErr(lastConfigIdResult)) return lastConfigIdResult;

  const [nodesResult, configurationsResult, versionResult] = await Promise.all([
    processChangesetInput(
      tx,
      "node",
      (input.nodes ?? []) as ChangesetsInput<"node">,
      {
        updatedAt: createdAt,
        lastEntityId: lastNodeIdResult.data,
      },
    ),
    processChangesetInput(
      tx,
      "config",
      (input.configurations ?? []) as ChangesetsInput<"config">,
      {
        updatedAt: createdAt,
        lastEntityId: lastConfigIdResult.data,
      },
    ),
    getVersion(tx),
  ]);

  if (isErr(nodesResult)) return nodesResult;
  if (isErr(configurationsResult)) return configurationsResult;
  if (isErr(versionResult)) return versionResult;

  const author = input.author ?? "";
  const previous = versionResult.data.hash;

  const configurations = configurationsResult.data;
  const nodes = nodesResult.data;
  const canonical = transactionToCanonical({
    nodes,
    configurations,
    author,
    createdAt,
    previous,
  });
  const hash = await hashTransaction(canonical);

  return ok({
    id: incrementEntityId(versionResult.data.id) as TransactionId,
    previous,
    hash,
    nodes,
    configurations,
    author,
    createdAt,
  });
};

export const applyTransaction = async (
  tx: DbTransaction,
  transaction: Transaction,
): ResultAsync<void> => {
  const nodeEntries = Object.entries(transaction.nodes);
  const configEntries = Object.entries(transaction.configurations);

  for (const [entityUid, changeset] of nodeEntries) {
    const result = await applyChangeset(
      tx,
      "node",
      entityUid as NodeUid,
      changeset,
    );
    if (isErr(result)) return result;
  }

  for (const [entityUid, changeset] of configEntries) {
    const result = await applyChangeset(
      tx,
      "config",
      entityUid as ConfigUid,
      changeset,
    );
    if (isErr(result)) return result;
  }

  const saveResult = await saveTransaction(tx, transaction);
  if (isErr(saveResult)) return saveResult;

  return ok(undefined);
};

export const rollbackTransaction = async (
  tx: DbTransaction,
  count: number,
  version: TransactionId,
): ResultAsync<void> => {
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

  if (currentId === 1)
    return err(
      createError(
        "invalid-rollback",
        "Cannot rollback the genesis transaction",
      ),
    );

  if (count > currentId - 1)
    return err(
      createError(
        "invalid-rollback",
        `Cannot rollback ${count} transactions, only ${currentId - 1} available`,
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
    errorToObject,
  );
  if (isErr(transactionsToRevertResult)) return transactionsToRevertResult;

  const transactionsToRevert: Transaction[] =
    transactionsToRevertResult.data.map((row) => ({
      id: row.id,
      hash: row.hash,
      previous: row.previous,
      nodes: row.nodes,
      configurations: row.configurations,
      author: row.author ?? undefined,
      createdAt: row.createdAt,
    }));

  for (const transaction of transactionsToRevert) {
    const inverseNodes = Object.fromEntries(
      Object.entries(transaction.nodes).map(([uid, changeset]) => [
        uid,
        inverseChangeset(changeset),
      ]),
    );

    const inverseConfigurations = Object.fromEntries(
      Object.entries(transaction.configurations).map(([uid, changeset]) => [
        uid,
        inverseChangeset(changeset),
      ]),
    );

    for (const [entityUid, changeset] of Object.entries(inverseNodes)) {
      const result = await tryCatch(
        applyChangeset(tx, "node", entityUid as NodeUid, changeset),
        errorToObject,
      );
      if (isErr(result)) return result;
    }

    for (const [entityUid, changeset] of Object.entries(
      inverseConfigurations,
    )) {
      const result = await tryCatch(
        applyChangeset(tx, "config", entityUid as ConfigUid, changeset),
        errorToObject,
      );
      if (isErr(result)) return result;
    }
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
    errorToObject,
  );
  if (isErr(deleteTransactionsResult)) return deleteTransactionsResult;

  return ok(undefined);
};

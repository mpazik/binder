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
  configSchema,
  type ConfigUid,
  type FieldChangeset,
  incrementEntityId,
  inverseChangeset,
  type NodeSchema,
  type NodeUid,
  type Transaction,
  type TransactionId,
  type TransactionInput,
  withHashTransaction,
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
  nodeSchema: NodeSchema,
): ResultAsync<Transaction> => {
  const createdAt = input.createdAt ?? newIsoTimestamp();

  const [lastNodeIdResult, lastConfigIdResult, versionResult] =
    await Promise.all([
      getLastEntityId(tx, "node"),
      getLastEntityId(tx, "config"),
      getVersion(tx),
    ]);
  if (isErr(lastNodeIdResult)) return lastNodeIdResult;
  if (isErr(lastConfigIdResult)) return lastConfigIdResult;
  if (isErr(versionResult)) return versionResult;

  const configurationsResult = await processChangesetInput(
    tx,
    "config",
    (input.configurations ?? []) as ChangesetsInput<"config">,
    configSchema,
    lastConfigIdResult.data,
  );

  if (isErr(configurationsResult)) return configurationsResult;
  const configurations = configurationsResult.data;

  const nodesResult = await processChangesetInput(
    tx,
    "node",
    (input.nodes ?? []) as ChangesetsInput<"node">,
    applyConfigChangesetToSchema(nodeSchema, configurationsResult.data),
    lastNodeIdResult.data,
  );
  if (isErr(nodesResult)) return nodesResult;

  return ok(
    await withHashTransaction(
      {
        nodes: nodesResult.data,
        configurations,
        author: input.author ?? "",
        createdAt,
        previous: versionResult.data.hash,
      },
      incrementEntityId(versionResult.data.id) as TransactionId,
    ),
  );
};

const addTxIdsToChangeset = (
  changeset: FieldChangeset,
  txId: TransactionId,
  kind: "insert" | "remove",
): FieldChangeset => ({
  ...changeset,
  txIds: {
    op: "seq",
    mutations: [kind === "insert" ? ["insert", txId] : ["remove", txId]],
  },
});

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
      addTxIdsToChangeset(changeset, transaction.id, "insert"),
    );
    if (isErr(result)) return result;
  }

  for (const [entityUid, changeset] of configEntries) {
    const result = await applyChangeset(
      tx,
      "config",
      entityUid as ConfigUid,
      addTxIdsToChangeset(changeset, transaction.id, "insert"),
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
        applyChangeset(
          tx,
          "node",
          entityUid as NodeUid,
          addTxIdsToChangeset(changeset, transaction.id, "remove"),
        ),
        errorToObject,
      );
      if (isErr(result)) return result;
    }

    for (const [entityUid, changeset] of Object.entries(
      inverseConfigurations,
    )) {
      const result = await tryCatch(
        applyChangeset(
          tx,
          "config",
          entityUid as ConfigUid,
          addTxIdsToChangeset(changeset, transaction.id, "remove"),
        ),
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

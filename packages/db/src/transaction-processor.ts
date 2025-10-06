import { isErr, newIsoTimestamp, ok, type ResultAsync } from "@binder/utils";
import {
  type ChangesetsInput,
  type ConfigUid,
  hashTransaction,
  incrementEntityId,
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
    processChangesetInput(tx, "node", input.nodes as ChangesetsInput<"node">, {
      updatedAt: createdAt,
      lastEntityId: lastNodeIdResult.data,
    }),
    processChangesetInput(
      tx,
      "config",
      input.configurations as ChangesetsInput<"config">,
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

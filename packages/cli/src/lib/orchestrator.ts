/**
 * Coordinates changes across database and log files
 */

import { join } from "path";
import {
  type Database,
  type KnowledgeGraph,
  openKnowledgeGraph,
  type Transaction,
  type TransactionId,
} from "@binder/db";
import {
  createError,
  err,
  isErr,
  ok,
  okVoid,
  type ResultAsync,
} from "@binder/utils";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../config.ts";
import type { KnowledgeGraphReadonly } from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import type { Logger } from "../log.ts";
import {
  clearLog,
  logTransaction,
  readLastTransactions,
  removeLastFromLog,
} from "./journal.ts";
import type { FileSystem } from "./filesystem.ts";

export type VerifySync = {
  dbOnlyTransactions: Transaction[];
  logOnlyTransactions: Transaction[];
  lastSyncedId: TransactionId;
};

export const verifySync = async (
  fs: FileSystem,
  kg: KnowledgeGraphReadonly,
  binderPath: string,
): ResultAsync<VerifySync> => {
  const logPath = join(binderPath, TRANSACTION_LOG_FILE);

  const versionResult = await kg.version();
  if (isErr(versionResult))
    return err(
      createError("version-fetch-failed", "Failed to fetch database version", {
        error: versionResult.error,
      }),
    );
  const dbTransactionCount = versionResult.data.id;

  const logTransactionsResult = await readLastTransactions(
    fs,
    logPath,
    dbTransactionCount + 100,
  );
  if (isErr(logTransactionsResult)) {
    return ok({
      dbOnlyTransactions: [],
      logOnlyTransactions: [],
      lastSyncedId: 0 as TransactionId,
    });
  }

  const logTransactions = logTransactionsResult.data;
  let divergenceId: TransactionId | null = null;

  for (let i = logTransactions.length - 1; i >= 0; i--) {
    const logTransaction = logTransactions[i]!;

    if (divergenceId !== null) continue;
    if (logTransaction.id > dbTransactionCount) continue;

    const dbTransactionResult = await kg.fetchTransaction(logTransaction.id);
    if (isErr(dbTransactionResult)) return dbTransactionResult;

    if (dbTransactionResult.data.hash !== logTransaction.hash) {
      divergenceId = logTransaction.id;
    }
  }

  const lastSyncedId = (
    divergenceId === null
      ? Math.min(dbTransactionCount, logTransactions.length)
      : divergenceId - 1
  ) as TransactionId;

  const dbOnlyTransactions: Transaction[] = [];
  for (let i = lastSyncedId + 1; i <= dbTransactionCount; i++) {
    const txResult = await kg.fetchTransaction(i as TransactionId);
    if (isErr(txResult)) return txResult;
    dbOnlyTransactions.push(txResult.data);
  }

  const logOnlyTransactions = logTransactions.slice(lastSyncedId);

  return ok({
    dbOnlyTransactions,
    logOnlyTransactions,
    lastSyncedId,
  });
};

export const repairDbFromLog = async (
  fs: FileSystem,
  db: Database,
  binderPath: string,
): ResultAsync<void> => {
  const kg = openKnowledgeGraph(db);
  const verifyResult = await verifySync(fs, kg, binderPath);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0)
    return okVoid;

  if (dbOnlyTransactions.length > 0) {
    const versionResult = await kg.version();
    if (isErr(versionResult)) return versionResult;

    const rollbackResult = await kg.rollback(
      dbOnlyTransactions.length,
      versionResult.data.id,
    );
    if (isErr(rollbackResult)) return rollbackResult;
  }

  for (const transaction of logOnlyTransactions) {
    const applyResult = await kg.apply(transaction);
    if (isErr(applyResult)) return applyResult;
  }

  return okVoid;
};

export const applyTransactions = async (
  kg: KnowledgeGraph,
  transactions: Transaction[],
): ResultAsync<Transaction[]> => {
  for (const tx of transactions) {
    const applyResult = await kg.apply(tx);
    if (isErr(applyResult)) return applyResult;
  }

  return ok(transactions);
};

export const undoTransactions = async (
  fs: FileSystem,
  kg: KnowledgeGraph,
  binderPath: string,
  steps: number,
): ResultAsync<Transaction[]> => {
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 0)
    return err(
      createError("invalid-undo", "Cannot undo the genesis transaction"),
    );

  if (steps > currentId)
    return err(
      createError(
        "invalid-undo",
        `Cannot undo ${steps} transactions, only ${currentId} available`,
      ),
    );

  const transactionsToUndo: Transaction[] = [];
  for (let i = 0; i < steps; i++) {
    const txId = (currentId - i) as TransactionId;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToUndo.push(txResult.data);
  }

  const rollbackResult = await kg.rollback(steps, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  const undoLogPath = join(binderPath, UNDO_LOG_FILE);
  for (const tx of transactionsToUndo) {
    const logResult = await logTransaction(fs, undoLogPath, tx);
    if (isErr(logResult)) return logResult;
  }

  const transactionLogPath = join(binderPath, TRANSACTION_LOG_FILE);
  const removeResult = await removeLastFromLog(fs, transactionLogPath, steps);
  if (isErr(removeResult)) return removeResult;

  return ok(transactionsToUndo);
};

export const redoTransactions = async (
  fs: FileSystem,
  kg: KnowledgeGraph,
  binderPath: string,
  steps: number,
): ResultAsync<Transaction[]> => {
  const undoLogPath = join(binderPath, UNDO_LOG_FILE);
  const undoLogResult = await readLastTransactions(fs, undoLogPath, steps);

  if (isErr(undoLogResult)) return undoLogResult;

  const undoLog = undoLogResult.data;
  if (undoLog.length === 0)
    return err(
      createError("empty-undo-log", "Nothing to redo: undo log is empty"),
    );

  if (steps > undoLog.length)
    return err(
      createError(
        "invalid-redo",
        `Cannot redo ${steps} transactions, only ${undoLog.length} available in undo log`,
      ),
    );

  const originalTransactions = undoLog.reverse();

  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentVersion = versionResult.data;
  const firstOriginalTx = originalTransactions[0]!;

  if (currentVersion.hash !== firstOriginalTx.previous)
    return err(
      createError(
        "version-mismatch",
        "Cannot redo: repository state has changed since undo",
      ),
    );

  for (const tx of originalTransactions) {
    const applyResult = await kg.apply(tx);
    if (isErr(applyResult)) return applyResult;
  }

  return ok(originalTransactions);
};

export const setupKnowledgeGraph = (
  db: Database,
  fs: FileSystem,
  binderPath: string,
  docsPath: string,
  dynamicDirectories: Array<{ path: string; query: string; template?: string }>,
  log: Logger,
): KnowledgeGraph => {
  const knowledgeGraph = openKnowledgeGraph(db, {
    beforeCommit: async (transaction: Transaction) => {
      const transactionLogPath = join(binderPath, TRANSACTION_LOG_FILE);
      const logResult = await logTransaction(
        fs,
        transactionLogPath,
        transaction,
      );
      if (isErr(logResult)) return logResult;
      const undoLogPath = join(binderPath, UNDO_LOG_FILE);
      const clearResult = await clearLog(fs, undoLogPath);
      if (isErr(clearResult)) return clearResult;
      return okVoid;
    },
    afterCommit: async () => {
      renderDocs(knowledgeGraph, log, docsPath, dynamicDirectories).then(
        (renderResult) => {
          if (isErr(renderResult)) {
            log.error("Failed to re-render docs after transaction", {
              error: renderResult.error,
            });
          }
        },
      );
    },
  });
  return knowledgeGraph;
};

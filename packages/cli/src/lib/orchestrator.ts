/**
 * Coordinates changes across database and log files
 */

import { join } from "path";
import {
  type Database,
  type KnowledgeGraph,
  openKnowledgeGraph,
  squashTransactions as mergeTransactions,
  type Transaction,
  type TransactionId,
} from "@binder/db";
import {
  createError,
  err,
  getTimestampForFileName,
  isErr,
  ok,
  okVoid,
  type ResultAsync,
} from "@binder/utils";
import {
  type AppConfig,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
} from "../config.ts";
import type { KnowledgeGraphReadonly } from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import type { Logger } from "../log.ts";
import type { DatabaseCli } from "../db";
import {
  clearLog,
  logTransaction,
  logTransactions,
  readLastTransactions,
  readTransactionsFromEnd,
  removeLastFromLog,
  verifyLog,
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
  const logVerifyResult = await verifyLog(fs, logPath);
  if (isErr(logVerifyResult)) return logVerifyResult;

  const versionResult = await kg.version();
  if (isErr(versionResult))
    return err(
      createError("version-fetch-failed", "Failed to fetch database version", {
        error: versionResult.error,
      }),
    );

  const logTransactionCount = logVerifyResult.data.count;
  const dbTransactionCount = versionResult.data.id;
  const dbOnlyTransactions: Transaction[] = [];
  const logOnlyTransactions: Transaction[] = [];

  let lastSyncedId = Math.min(
    dbTransactionCount,
    logTransactionCount,
  ) as TransactionId;

  for (let i = dbTransactionCount; i > lastSyncedId; i--) {
    const txResult = await kg.fetchTransaction(i as TransactionId);
    if (isErr(txResult)) return txResult;
    dbOnlyTransactions.push(txResult.data);
  }

  const logIterator = readTransactionsFromEnd(fs, logPath);

  for (let i = logTransactionCount; i > lastSyncedId; i--) {
    const result = await logIterator.next();
    if (result.done) break;
    if (isErr(result.value)) return result.value;
    logOnlyTransactions.push(result.value.data);
  }

  for (let i = lastSyncedId; i >= 1; i--) {
    const result = await logIterator.next();
    if (result.done) break;
    if (isErr(result.value)) return result.value;
    const logTx = result.value.data;

    const dbTxResult = await kg.fetchTransaction(i as TransactionId);
    if (isErr(dbTxResult)) return dbTxResult;
    const dbTx = dbTxResult.data;

    if (dbTx.hash === logTx.hash) break;

    dbOnlyTransactions.push(dbTx);
    logOnlyTransactions.push(logTx);
    lastSyncedId = (i - 1) as TransactionId;
  }

  return ok({
    dbOnlyTransactions: dbOnlyTransactions.reverse(),
    logOnlyTransactions: logOnlyTransactions.reverse(),
    lastSyncedId,
  });
};

export const repairDbFromLog = async (
  fs: FileSystem,
  db: Database,
  binderPath: string,
): ResultAsync<{ dbTransactionsPath?: string }> => {
  const kg = openKnowledgeGraph(db);
  const verifyResult = await verifySync(fs, kg, binderPath);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0)
    return ok({ dbTransactionsPath: undefined });

  let dbTransactionsPath: string | undefined;

  if (dbOnlyTransactions.length > 0) {
    const filename = `repair-db-transactions-${getTimestampForFileName()}.jsonl.bac`;
    dbTransactionsPath = join(binderPath, filename);

    const snapshotResult = await logTransactions(
      fs,
      dbTransactionsPath,
      dbOnlyTransactions,
    );
    if (isErr(snapshotResult)) return snapshotResult;

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

  return ok({ dbTransactionsPath });
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

type Services = {
  db: DatabaseCli;
  fs: FileSystem;
  log: Logger;
  config: AppConfig;
};

export const setupKnowledgeGraph = (services: Services): KnowledgeGraph => {
  const {
    db,
    fs,
    log,
    config: { paths },
  } = services;
  const knowledgeGraph = openKnowledgeGraph(db, {
    beforeCommit: async (transaction: Transaction) => {
      const transactionLogPath = join(paths.binder, TRANSACTION_LOG_FILE);
      const logResult = await logTransaction(
        fs,
        transactionLogPath,
        transaction,
      );
      if (isErr(logResult)) return logResult;
      const undoLogPath = join(paths.binder, UNDO_LOG_FILE);
      const clearResult = await clearLog(fs, undoLogPath);
      if (isErr(clearResult)) return clearResult;
      return okVoid;
    },
    afterCommit: async () => {
      renderDocs({ ...services, kg: knowledgeGraph }).then((renderResult) => {
        if (isErr(renderResult)) {
          log.error("Failed to re-render docs after transaction", {
            error: renderResult.error,
          });
        }
      });
    },
    afterRollback: async () => {
      renderDocs({ ...services, kg: knowledgeGraph }).then((renderResult) => {
        if (isErr(renderResult)) {
          log.error("Failed to re-render docs after transaction", {
            error: renderResult.error,
          });
        }
      });
    },
  });
  return knowledgeGraph;
};

export const squashTransactions = async (
  services: Services,
  count: number,
): ResultAsync<Transaction> => {
  const {
    db,
    fs,
    config: { paths },
  } = services;

  if (count < 2)
    return err(
      createError(
        "invalid-count",
        `Count must be at least 2 to squash, got ${count}`,
      ),
    );

  const plainKg = openKnowledgeGraph(db);

  const versionResult = await plainKg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 0)
    return err(
      createError("invalid-squash", "Cannot squash the genesis transaction"),
    );

  if (count > currentId)
    return err(
      createError(
        "invalid-squash",
        `Cannot squash ${count} transactions, only ${currentId} available`,
      ),
    );

  const transactionLogPath = join(paths.binder, TRANSACTION_LOG_FILE);
  const logResult = await readLastTransactions(fs, transactionLogPath, count);
  if (isErr(logResult)) return logResult;

  const logTransactions = logResult.data;

  if (logTransactions.length !== count)
    return err(
      createError(
        "log-inconsistency",
        `Log contains ${logTransactions.length} transactions but expected ${count}`,
      ),
    );

  const dbTransactions: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const txId = (currentId - count + 1 + i) as TransactionId;
    const txResult = await plainKg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    dbTransactions.push(txResult.data);
  }

  for (let i = 0; i < count; i++) {
    if (logTransactions[i]!.hash !== dbTransactions[i]!.hash)
      return err(
        createError(
          "log-db-mismatch",
          `Transaction #${dbTransactions[i]!.id} hash mismatch between log and database`,
        ),
      );
  }

  const squashedTransaction = await mergeTransactions(dbTransactions);

  const removeResult = await removeLastFromLog(fs, transactionLogPath, count);
  if (isErr(removeResult)) return removeResult;

  const rollbackResult = await plainKg.rollback(count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  const kgWithCallbacks = setupKnowledgeGraph(services);
  const applyResult = await applyTransactions(kgWithCallbacks, [
    squashedTransaction,
  ]);
  if (isErr(applyResult)) return applyResult;

  return ok(squashedTransaction);
};

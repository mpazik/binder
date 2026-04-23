import { join } from "path";
import {
  type KnowledgeGraph,
  type KnowledgeGraphCallbacks,
  openKnowledgeGraph,
  squashTransactions as mergeTransactions,
  type Transaction,
  type TransactionId,
} from "@binder/repo";
import {
  fail,
  getTimestampForFileName,
  isErr,
  ok,
  okVoid,
  type ResultAsync,
} from "@binder/utils";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../config.ts";
import { renderDocs } from "../document/repository.ts";
import { cliConfigSchema } from "../cli-config-schema.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import {
  clearLog,
  logTransaction,
  logTransactions,
  readLastTransactions,
  readTransactionsFromEnd,
  removeLastFromLog,
  verifyLog,
} from "./journal.ts";
import { acquireLock, releaseLock } from "./lock.ts";

export type VerifySync = {
  dbOnlyTransactions: Transaction[];
  logOnlyTransactions: Transaction[];
  lastSyncedId: TransactionId;
};

export type VerifySyncCtx = Pick<RuntimeContextWithDb, "fs" | "kg">;

export const verifySync = async (
  ctx: VerifySyncCtx,
  dataPath: string,
): ResultAsync<VerifySync> => {
  const { fs, kg } = ctx;
  const logPath = join(dataPath, TRANSACTION_LOG_FILE);
  const logVerifyResult = await verifyLog(fs, logPath);
  if (isErr(logVerifyResult)) return logVerifyResult;

  const versionResult = await kg.version();
  if (isErr(versionResult))
    return fail("version-fetch-failed", "Failed to fetch database version", {
      data: { error: versionResult.error },
    });

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

type OrchestratorCtx = Pick<
  RuntimeContextWithDb,
  "db" | "fs" | "log" | "config" | "views"
>;

const withLockedKg = async <T>(
  ctx: OrchestratorCtx,
  operation: (kg: KnowledgeGraph) => ResultAsync<T>,
): ResultAsync<T> => {
  const { db, fs, log, config } = ctx;
  const { paths } = config;

  const lockResult = await acquireLock(fs, paths.data);
  if (isErr(lockResult)) return lockResult;

  const kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
  const result = await operation(kg);

  await releaseLock(fs, paths.data);

  if (!isErr(result)) {
    const renderResult = await renderDocs({ ...ctx, kg });
    if (isErr(renderResult)) {
      log.error("Failed to re-render docs", { error: renderResult.error });
    }
  }

  return result;
};

export const repairDbFromLog = async (
  ctx: OrchestratorCtx,
): ResultAsync<{ dbTransactionsPath?: string }> => {
  const {
    fs,
    config: { paths },
  } = ctx;

  return withLockedKg(ctx, async (kg) => {
    const verifyResult = await verifySync({ fs, kg }, paths.data);
    if (isErr(verifyResult)) return verifyResult;

    const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

    if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0)
      return ok({ dbTransactionsPath: undefined });

    let dbTransactionsPath: string | undefined;

    if (dbOnlyTransactions.length > 0) {
      const filename = `repair-db-transactions-${getTimestampForFileName()}.jsonl.bac`;
      dbTransactionsPath = join(paths.backups, filename);

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
  });
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
  ctx: OrchestratorCtx,
  steps: number,
): ResultAsync<Transaction[]> => {
  const {
    fs,
    config: { paths },
  } = ctx;

  return withLockedKg(ctx, async (kg) => {
    const versionResult = await kg.version();
    if (isErr(versionResult)) return versionResult;

    const currentId = versionResult.data.id;
    if (currentId === 0)
      return fail("invalid-undo", "Cannot undo the genesis transaction");

    if (steps > currentId)
      return fail(
        "invalid-undo",
        `Cannot undo ${steps} transactions, only ${currentId} available`,
      );

    const transactionsToUndo: Transaction[] = [];
    for (let i = 0; i < steps; i++) {
      const txId = (currentId - i) as TransactionId;
      const txResult = await kg.fetchTransaction(txId);
      if (isErr(txResult)) return txResult;
      transactionsToUndo.push(txResult.data);
    }

    const transactionLogPath = join(paths.data, TRANSACTION_LOG_FILE);
    const logTailResult = await readLastTransactions(
      fs,
      transactionLogPath,
      steps,
    );
    if (isErr(logTailResult)) return logTailResult;

    const logTail = logTailResult.data;
    if (logTail.length !== steps)
      return fail(
        "log-db-mismatch",
        `Log has ${logTail.length} transaction(s) but expected ${steps} to undo`,
      );

    for (let i = 0; i < steps; i++) {
      const dbTx = transactionsToUndo[i]!;
      const logTx = logTail[steps - 1 - i]!;
      if (dbTx.hash !== logTx.hash)
        return fail(
          "log-db-mismatch",
          `Transaction log and database are out of sync — run \`binder tx repair\` to fix`,
          { data: { dbHash: dbTx.hash, logHash: logTx.hash, step: i + 1 } },
        );
    }

    const rollbackResult = await kg.rollback(steps, currentId);
    if (isErr(rollbackResult)) return rollbackResult;

    const undoLogPath = join(paths.data, UNDO_LOG_FILE);
    for (const tx of transactionsToUndo) {
      const logResult = await logTransaction(fs, undoLogPath, tx);
      if (isErr(logResult)) return logResult;
    }

    const removeResult = await removeLastFromLog(fs, transactionLogPath, steps);
    if (isErr(removeResult)) return removeResult;

    return ok(transactionsToUndo);
  });
};

export const redoTransactions = async (
  ctx: OrchestratorCtx,
  steps: number,
): ResultAsync<Transaction[]> => {
  const {
    fs,
    config: { paths },
  } = ctx;

  return withLockedKg(ctx, async (kg) => {
    const undoLogPath = join(paths.data, UNDO_LOG_FILE);
    const undoLogResult = await readLastTransactions(fs, undoLogPath, steps);
    if (isErr(undoLogResult)) return undoLogResult;

    const undoLog = undoLogResult.data;
    if (undoLog.length === 0)
      return fail("empty-undo-log", "Nothing to redo: undo log is empty");

    if (steps > undoLog.length)
      return fail(
        "invalid-redo",
        `Cannot redo ${steps} transactions, only ${undoLog.length} available in undo log`,
      );

    const originalTransactions = undoLog.reverse();

    const versionResult = await kg.version();
    if (isErr(versionResult)) return versionResult;

    const currentVersion = versionResult.data;
    const firstOriginalTx = originalTransactions[0]!;

    if (currentVersion.hash !== firstOriginalTx.previous)
      return fail(
        "version-mismatch",
        "Cannot redo: repository state has changed since undo",
      );

    const transactionLogPath = join(paths.data, TRANSACTION_LOG_FILE);

    for (const tx of originalTransactions) {
      const applyResult = await kg.apply(tx);
      if (isErr(applyResult)) return applyResult;

      const logResult = await logTransaction(fs, transactionLogPath, tx);
      if (isErr(logResult)) return logResult;
    }

    const clearResult = await clearLog(fs, undoLogPath);
    if (isErr(clearResult)) return clearResult;

    return ok(originalTransactions);
  });
};

export type OrchestratorCallbacks = KnowledgeGraphCallbacks & {
  onFilesUpdated?: (paths: string[]) => void;
};

/**
 * Returns a factory `(kg) => KnowledgeGraphCallbacks` so the render callback
 * can close over the final knowledge graph. Transitional — will become plugins.
 */
export const buildOrchestratorCallbacks =
  (
    ctx: OrchestratorCtx,
    callbacks: OrchestratorCallbacks,
  ): ((kg: KnowledgeGraph) => KnowledgeGraphCallbacks) =>
  (kg: KnowledgeGraph): KnowledgeGraphCallbacks => {
    const {
      fs,
      log,
      config: { paths },
    } = ctx;

    const renderAndNotify = async (context: string) => {
      const renderResult = await renderDocs({ ...ctx, kg });
      if (isErr(renderResult)) {
        log.error(`Failed to re-render docs after ${context}`, {
          error: renderResult.error,
        });
        return;
      }

      if (
        callbacks.onFilesUpdated &&
        renderResult.data.modifiedPaths.length > 0
      ) {
        await callbacks.onFilesUpdated(renderResult.data.modifiedPaths);
      }
    };

    return {
      beforeTransaction: async () => {
        const lockResult = await acquireLock(fs, paths.data);
        if (isErr(lockResult)) {
          log.error("Failed to acquire lock", { error: lockResult.error });
          return lockResult;
        }

        log.debug("Lock acquired for transaction");

        return ok(async () => {
          await releaseLock(fs, paths.data);
          log.debug("Lock released (rollback)");
          return okVoid;
        });
      },
      beforeCommit: async (transaction: Transaction) => {
        const transactionLogPath = join(paths.data, TRANSACTION_LOG_FILE);
        const logResult = await logTransaction(
          fs,
          transactionLogPath,
          transaction,
        );
        if (isErr(logResult)) return logResult;
        const undoLogPath = join(paths.data, UNDO_LOG_FILE);
        const clearResult = await clearLog(fs, undoLogPath);
        if (isErr(clearResult)) return clearResult;
        return okVoid;
      },
      afterCommit: async (transaction) => {
        await releaseLock(fs, paths.data);
        log.debug("Lock released after commit");

        // Invalidate caches before rendering (e.g., view cache)
        await callbacks.afterCommit?.(transaction);
        await renderAndNotify("transaction");
      },
      afterRollback: async (transactions, count) => {
        await callbacks.afterRollback?.(transactions, count);
        await renderAndNotify("rollback");
      },
    };
  };

export const squashTransactions = async (
  ctx: OrchestratorCtx,
  count: number,
): ResultAsync<Transaction> => {
  const {
    fs,
    config: { paths },
  } = ctx;

  if (count < 2)
    return fail(
      "invalid-count",
      `Count must be at least 2 to squash, got ${count}`,
    );

  return withLockedKg(ctx, async (kg) => {
    const versionResult = await kg.version();
    if (isErr(versionResult)) return versionResult;

    const currentId = versionResult.data.id;
    if (currentId === 0)
      return fail("invalid-squash", "Cannot squash the genesis transaction");

    if (count > currentId)
      return fail(
        "invalid-squash",
        `Cannot squash ${count} transactions, only ${currentId} available`,
      );

    const transactionLogPath = join(paths.data, TRANSACTION_LOG_FILE);
    const logResult = await readLastTransactions(fs, transactionLogPath, count);
    if (isErr(logResult)) return logResult;

    const logEntries = logResult.data;

    if (logEntries.length !== count)
      return fail(
        "log-inconsistency",
        `Log contains ${logEntries.length} transactions but expected ${count}`,
      );

    const dbTransactions: Transaction[] = [];
    for (let i = 0; i < count; i++) {
      const txId = (currentId - count + 1 + i) as TransactionId;
      const txResult = await kg.fetchTransaction(txId);
      if (isErr(txResult)) return txResult;
      dbTransactions.push(txResult.data);
    }

    for (let i = 0; i < count; i++) {
      if (logEntries[i]!.hash !== dbTransactions[i]!.hash)
        return fail(
          "log-db-mismatch",
          `Transaction #${dbTransactions[i]!.id} hash mismatch between log and database`,
        );
    }

    const recordSchemaResult = await kg.getRecordSchema();
    if (isErr(recordSchemaResult)) return recordSchemaResult;

    const squashedTransaction = await mergeTransactions(
      dbTransactions,
      recordSchemaResult.data,
      kg.getConfigSchema(),
    );

    const removeResult = await removeLastFromLog(fs, transactionLogPath, count);
    if (isErr(removeResult)) return removeResult;

    const rollbackResult = await kg.rollback(count, currentId);
    if (isErr(rollbackResult)) return rollbackResult;

    const applyResult = await kg.apply(squashedTransaction);
    if (isErr(applyResult)) return applyResult;

    const logTransactionResult = await logTransaction(
      fs,
      transactionLogPath,
      squashedTransaction,
    );
    if (isErr(logTransactionResult)) return logTransactionResult;

    const undoLogPath = join(paths.data, UNDO_LOG_FILE);
    const clearResult = await clearLog(fs, undoLogPath);
    if (isErr(clearResult)) return clearResult;

    return ok(squashedTransaction);
  });
};

import { join } from "node:path";
import {
  type KnowledgeGraph,
  openKnowledgeGraph,
  parseTransaction,
  serializeTransaction,
  type Transaction,
  type TransactionId,
} from "@binder/repo";
import {
  appendLine,
  appendLines,
  clearLog,
  fail,
  getTimestampForFileName,
  isErr,
  ok,
  readLinesFromEnd,
  type ResultAsync,
} from "@binder/utils";
import { TRANSACTION_LOG_FILE } from "../../config.ts";
import { cliConfigSchema } from "../../cli-config-schema.ts";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import { verifyLog } from "./integrity.ts";

export type VerifySync = {
  dbOnlyTransactions: Transaction[];
  logOnlyTransactions: Transaction[];
  lastSyncedId: TransactionId;
};

export type VerifySyncCtx = Pick<RuntimeContextWithDb, "fs" | "kg">;
export type RepairDbCtx = Pick<RuntimeContextWithDb, "fs" | "kg" | "config">;
export type RepairLogCtx = Pick<RuntimeContextWithDb, "fs" | "db" | "config">;

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

  const logIterator = readLinesFromEnd(fs, logPath, parseTransaction);

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

/**
 * Repair: treat the transaction log as authoritative and sync the database
 * to match. Operates on the runtime `kg` directly — both plugins react via
 * their subscriptions.
 */
export const repairDbFromLog = async (
  ctx: RepairDbCtx,
): ResultAsync<{ dbTransactionsPath?: string }> => {
  const {
    fs,
    kg,
    config: { paths },
  } = ctx;

  const verifyResult = await verifySync({ fs, kg }, paths.data);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0)
    return ok({ dbTransactionsPath: undefined });

  let dbTransactionsPath: string | undefined;

  if (dbOnlyTransactions.length > 0) {
    const filename = `repair-db-transactions-${getTimestampForFileName()}.jsonl.bac`;
    dbTransactionsPath = join(paths.backups, filename);

    const snapshotResult = await appendLines(
      fs,
      dbTransactionsPath,
      dbOnlyTransactions,
      serializeTransaction,
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

/**
 * Repair: treat the database as authoritative and sync the transaction log
 * to match. Does not need kg mutations — writes the log file directly.
 */
export const repairLogFromDb = async (
  ctx: RepairLogCtx,
  options?: { force?: boolean },
): ResultAsync<{ logBackupPath?: string }> => {
  const {
    fs,
    db,
    config: { paths },
  } = ctx;
  const transactionLogPath = join(paths.data, TRANSACTION_LOG_FILE);

  const kgForRead = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
  const verifyResult = await verifySync({ fs, kg: kgForRead }, paths.data);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0)
    return ok({ logBackupPath: undefined });

  if (logOnlyTransactions.length > 0 && !options?.force) {
    return fail(
      "log-ahead",
      `Log has ${logOnlyTransactions.length} transaction(s) not in database. Use --from-log to treat log as authoritative, or --force to overwrite log from DB.`,
    );
  }

  let logBackupPath: string | undefined;

  if (await fs.exists(transactionLogPath)) {
    const timestamp = getTimestampForFileName();
    const backupFileName = `journal-${timestamp}.jsonl.bac`;
    logBackupPath = join(paths.backups, backupFileName);

    const readResult = await fs.readFile(transactionLogPath);
    if (isErr(readResult)) return readResult;
    const writeResult = await fs.writeFile(logBackupPath, readResult.data);
    if (isErr(writeResult)) return writeResult;
  }

  if (options?.force && logOnlyTransactions.length > 0) {
    const clearResult = await clearLog(fs, transactionLogPath);
    if (isErr(clearResult)) return clearResult;

    const versionResult = await kgForRead.version();
    if (isErr(versionResult)) return versionResult;

    for (let i = 1; i <= versionResult.data.id; i++) {
      const txResult = await kgForRead.fetchTransaction(i as TransactionId);
      if (isErr(txResult)) return txResult;
      const logResult = await appendLine(
        fs,
        transactionLogPath,
        txResult.data,
        serializeTransaction,
      );
      if (isErr(logResult)) return logResult;
    }

    return ok({ logBackupPath });
  }

  for (const transaction of dbOnlyTransactions) {
    const logResult = await appendLine(
      fs,
      transactionLogPath,
      transaction,
      serializeTransaction,
    );
    if (isErr(logResult)) return logResult;
  }

  return ok({ logBackupPath });
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

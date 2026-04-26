import { basename, join } from "path";
import {
  applyConfigChangesetToSchema,
  coreRecordSchema,
  GENESIS_VERSION,
  hashTransaction,
  type RecordSchema,
  type Transaction,
  type TransactionHash,
  transactionToCanonical,
  withHashTransaction,
} from "@binder/repo";
import {
  fail,
  getTimestampForFileName,
  isErr,
  ok,
  okVoid,
  parseJson,
  type Result,
  type ResultAsync,
  isObjectNonEmpty,
} from "@binder/utils";
import { cliFullConfigSchema } from "../cli-config-schema.ts";
import type { FileSystem } from "./filesystem.ts";

const CHUNK_SIZE = 65536;

const readLinesFromEnd = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<
  Result<{ line: string; bytePositionBefore: number }>,
  void,
  unknown
> {
  const statResult = fs.stat(path);
  if (isErr(statResult)) return;

  const fileSize = statResult.data.size;
  if (fileSize === 0) return;

  let position = fileSize;
  let partialLine = "";
  const encoder = new TextEncoder();

  while (position > 0) {
    const readStart = Math.max(position - CHUNK_SIZE, 0);
    const sliceResult = await fs.slice(path, readStart, position);
    if (isErr(sliceResult)) {
      yield fail("file-read-error", "Failed to read transaction log", {
        data: { path, error: sliceResult.error },
      });
      return;
    }

    const chunk = new TextDecoder().decode(sliceResult.data);
    const chunkLines = chunk.split("\n");

    if (position < fileSize) {
      chunkLines[chunkLines.length - 1] =
        chunkLines[chunkLines.length - 1]! + partialLine;
    }

    if (readStart > 0) {
      partialLine = chunkLines[0]!;
      chunkLines.shift();
    }

    let bytesProcessed = 0;
    for (let i = chunkLines.length - 1; i >= 0; i--) {
      const line = chunkLines[i]!;
      const trimmedLine = line.trim();

      if (trimmedLine.length > 0) {
        const lineBytes = encoder.encode(line + "\n");
        const bytePositionBefore = position - bytesProcessed - lineBytes.length;
        yield ok({ line: trimmedLine, bytePositionBefore });
        bytesProcessed += lineBytes.length;
      }
    }

    position = readStart;
  }
};

const readLinesFromBeginning = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<string>, void, unknown> {
  const statResult = fs.stat(path);
  if (isErr(statResult)) return;

  const fileSize = statResult.data.size;
  if (fileSize === 0) return;

  let position = 0;
  let partialLine = "";

  while (position < fileSize) {
    const readEnd = Math.min(position + CHUNK_SIZE, fileSize);
    const sliceResult = await fs.slice(path, position, readEnd);
    if (isErr(sliceResult)) {
      yield fail("file-read-error", "Failed to read transaction log", {
        data: { path, error: sliceResult.error },
      });
      return;
    }

    const chunk = new TextDecoder().decode(sliceResult.data);
    const chunkLines = (partialLine + chunk).split("\n");

    if (readEnd < fileSize) {
      partialLine = chunkLines.pop()!;
    } else {
      partialLine = "";
    }

    for (const line of chunkLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        yield ok(trimmedLine);
      }
    }

    position = readEnd;
  }

  if (partialLine.trim().length > 0) {
    yield ok(partialLine.trim());
  }
};

const parseTransaction = (line: string): Result<Transaction> => {
  const result = parseJson<Transaction>(
    line,
    "Failed to parse transaction from log",
  );
  if (isErr(result)) return result;
  const { records = {}, configs = {}, ...rest } = result.data;
  return ok({ ...rest, records, configs });
};

export const readTransactionsFromEnd = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<Transaction>, void, unknown> {
  for await (const result of readLinesFromEnd(fs, path)) {
    if (isErr(result)) yield result;
    else yield parseTransaction(result.data.line);
  }
};

const readTransactionsFromBeginning = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<Transaction>, void, unknown> {
  for await (const result of readLinesFromBeginning(fs, path)) {
    if (isErr(result)) yield result;
    else yield parseTransaction(result.data);
  }
};

export const logTransaction = (
  fs: FileSystem,
  path: string,
  transaction: Transaction,
): ResultAsync<void> => {
  const { records, configs, tags, message, source, channel, ...core } =
    transaction;
  const entry = {
    ...core,
    ...(isObjectNonEmpty(records) && { records }),
    ...(isObjectNonEmpty(configs) && { configs }),
    tags,
    ...(message !== undefined && { message }),
    ...(source !== undefined && { source }),
    ...(channel !== undefined && { channel }),
  };
  return fs.appendFile(path, JSON.stringify(entry) + "\n");
};

export const logTransactions = async (
  fs: FileSystem,
  path: string,
  transactions: Transaction[],
): ResultAsync<void> => {
  for (const tx of transactions) {
    const result = await logTransaction(fs, path, tx);
    if (isErr(result)) return result;
  }
  return okVoid;
};

export const readLastTransactions = async (
  fs: FileSystem,
  path: string,
  count: number,
): ResultAsync<Transaction[]> => {
  if (count === 0) return ok([]);

  const transactions: Transaction[] = [];
  for await (const result of readTransactionsFromEnd(fs, path)) {
    if (isErr(result)) return result;
    transactions.push(result.data);
    if (transactions.length >= count) break;
  }

  return ok(transactions.reverse());
};

export const readTransactions = async (
  fs: FileSystem,
  path: string,
  count: number,
  filter: { author?: string } = {},
  order: "asc" | "desc" = "desc",
): ResultAsync<Transaction[]> => {
  if (count === 0) return ok([]);

  const transactions: Transaction[] = [];
  const generator =
    order === "asc"
      ? readTransactionsFromBeginning(fs, path)
      : readTransactionsFromEnd(fs, path);

  for await (const result of generator) {
    if (isErr(result)) return result;

    if (filter.author && result.data.author !== filter.author) continue;

    transactions.push(result.data);
    if (transactions.length >= count) break;
  }
  return ok(transactions);
};

export const readTransactionRange = async (
  fs: FileSystem,
  path: string,
  from?: number,
  to?: number,
): ResultAsync<Transaction[]> => {
  const transactions: Transaction[] = [];

  for await (const result of readTransactionsFromBeginning(fs, path)) {
    if (isErr(result)) return result;

    const tx = result.data;
    if (from !== undefined && tx.id < from) continue;
    if (to !== undefined && tx.id > to) break;

    transactions.push(tx);
  }

  return ok(transactions);
};

export const removeLastFromLog = async (
  fs: FileSystem,
  path: string,
  count: number,
): ResultAsync<void> => {
  let truncatePosition = 0;
  let transactionsFound = 0;

  for await (const result of readLinesFromEnd(fs, path)) {
    if (isErr(result)) return result;

    transactionsFound++;
    if (transactionsFound === count) {
      truncatePosition = result.data.bytePositionBefore;
      break;
    }
  }

  if (count > transactionsFound)
    return fail(
      "invalid-count",
      `Cannot remove ${count} transactions, only ${transactionsFound} available in log`,
    );

  return fs.truncate(path, truncatePosition);
};

export const clearLog = (fs: FileSystem, path: string): ResultAsync<void> =>
  fs.writeFile(path, "");

export const verifyLog = async (
  fs: FileSystem,
  path: string,
  options?: { verifyIntegrity?: boolean },
): ResultAsync<{ count: number }> => {
  if (!(await fs.exists(path))) return ok({ count: 0 });

  let count = 0;
  let lineNumber = 0;
  let previousHash: TransactionHash = GENESIS_VERSION.hash;
  let schema: RecordSchema = coreRecordSchema();

  for await (const result of readTransactionsFromBeginning(fs, path)) {
    lineNumber++;

    if (isErr(result))
      return fail(
        "parse-error",
        `Failed to parse transaction at line ${lineNumber}`,
        {
          data: { line: lineNumber, error: result.error },
        },
      );

    const transaction = result.data;
    if (transaction.previous !== previousHash)
      return fail(
        "chain-error",
        `Transaction chain broken at transaction ${lineNumber}`,
        {
          data: {
            transactionId: transaction.id,
            expectedPrevious: previousHash,
            actualPrevious: transaction.previous,
          },
        },
      );

    if (isObjectNonEmpty(transaction.configs)) {
      schema = applyConfigChangesetToSchema(schema, transaction.configs);
    }

    if (options?.verifyIntegrity) {
      const canonical = transactionToCanonical(
        cliFullConfigSchema,
        schema,
        transaction,
      );
      const expectedHash = await hashTransaction(canonical);

      if (expectedHash !== transaction.hash)
        return fail(
          "hash-mismatch",
          `Transaction hash mismatch at transaction ${lineNumber}`,
          {
            data: {
              transactionId: transaction.id,
              expectedHash,
              actualHash: transaction.hash,
            },
          },
        );
    }

    previousHash = transaction.hash;
    count++;
  }

  return ok({ count });
};

export const rehashLog = async (
  fs: FileSystem,
  path: string,
  options?: { backupDir?: string },
): ResultAsync<{ transactionsRehashed: number; backupPath: string }> => {
  if (!(await fs.exists(path)))
    return fail("file-not-found", "Transaction log file does not exist", {
      data: { path },
    });

  const timestamp = getTimestampForFileName();
  const backupFileName = basename(path).replace(
    /\.jsonl$/,
    `-${timestamp}.jsonl.bac`,
  );
  const backupPath = options?.backupDir
    ? join(options.backupDir, backupFileName)
    : path.replace(/\.jsonl$/, `-${timestamp}.jsonl.bac`);

  const renameResult = await fs.renameFile(path, backupPath);
  if (isErr(renameResult)) return renameResult;

  const clearResult = await clearLog(fs, path);
  if (isErr(clearResult)) return clearResult;

  let previousHash: TransactionHash = GENESIS_VERSION.hash;
  let schema: RecordSchema = coreRecordSchema();
  let transactionsRehashed = 0;

  for await (const result of readTransactionsFromBeginning(fs, backupPath)) {
    if (isErr(result)) return result;

    const tx = { ...result.data, previous: previousHash };
    if (isObjectNonEmpty(tx.configs)) {
      schema = applyConfigChangesetToSchema(schema, tx.configs);
    }
    const rehashedTx = await withHashTransaction(
      cliFullConfigSchema,
      schema,
      tx,
      tx.id,
    );
    const logResult = await logTransaction(fs, path, rehashedTx);
    if (isErr(logResult)) return logResult;
    previousHash = rehashedTx.hash;
    transactionsRehashed++;
  }

  return ok({ transactionsRehashed, backupPath });
};

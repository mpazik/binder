/**
 * Facilitates writing to log files
 */

import {
  type ConfigSchema,
  GENESIS_VERSION,
  hashTransaction,
  type NodeSchema,
  type Transaction,
  type TransactionHash,
  transactionToCanonical,
  withHashTransaction,
} from "@binder/db";
import {
  createError,
  err,
  getTimestampForFileName,
  isErr,
  ok,
  okVoid,
  parseJson,
  type Result,
  type ResultAsync,
} from "@binder/utils";
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
      yield err(
        createError("file-read-error", "Failed to read transaction log", {
          path,
          error: sliceResult.error,
        }),
      );
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
      yield err(
        createError("file-read-error", "Failed to read transaction log", {
          path,
          error: sliceResult.error,
        }),
      );
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
  return parseJson<Transaction>(line, "Failed to parse transaction from log");
};

export const readTransactionsFromEnd = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<Transaction>, void, unknown> {
  for await (const result of readLinesFromEnd(fs, path)) {
    if (isErr(result)) {
      yield result;
    } else {
      yield parseTransaction(result.data.line);
    }
  }
};

const readTransactionsFromBeginning = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<Transaction>, void, unknown> {
  for await (const result of readLinesFromBeginning(fs, path)) {
    if (isErr(result)) {
      yield result;
    } else {
      yield parseTransaction(result.data);
    }
  }
};

export const logTransaction = (
  fs: FileSystem,
  path: string,
  transaction: Transaction,
): ResultAsync<void> => {
  const json = JSON.stringify(transaction);
  return fs.appendFile(path, json + "\n");
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

    const transaction = result.data;
    if (filter.author && transaction.author !== filter.author) continue;

    transactions.push(transaction);
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
    return err(
      createError(
        "invalid-count",
        `Cannot remove ${count} transactions, only ${transactionsFound} available in log`,
      ),
    );

  return await fs.truncate(path, truncatePosition);
};

export const clearLog = async (
  fs: FileSystem,
  path: string,
): ResultAsync<void> => await fs.writeFile(path, "");

export const verifyLog = async (
  fs: FileSystem,
  configSchema: ConfigSchema,
  nodeSchema: NodeSchema,
  path: string,
  options?: { verifyIntegrity?: boolean },
): ResultAsync<{ count: number }> => {
  if (!(await fs.exists(path))) return ok({ count: 0 });

  let count = 0;
  let lineNumber = 0;
  let previousHash: TransactionHash = GENESIS_VERSION.hash;

  for await (const result of readTransactionsFromBeginning(fs, path)) {
    lineNumber++;

    if (isErr(result))
      return err(
        createError(
          "parse-error",
          `Failed to parse transaction at line ${lineNumber}`,
          {
            line: lineNumber,
            error: result.error,
          },
        ),
      );

    const transaction = result.data;
    if (transaction.previous !== previousHash)
      return err(
        createError(
          "chain-error",
          `Transaction chain broken at transaction ${lineNumber}`,
          {
            transactionId: transaction.id,
            expectedPrevious: previousHash,
            actualPrevious: transaction.previous,
          },
        ),
      );

    if (options?.verifyIntegrity) {
      const canonical = transactionToCanonical(
        configSchema,
        nodeSchema,
        transaction,
      );
      const expectedHash = await hashTransaction(canonical);

      if (expectedHash !== transaction.hash)
        return err(
          createError(
            "hash-mismatch",
            `Transaction hash mismatch at transaction ${lineNumber}`,
            {
              transactionId: transaction.id,
              expectedHash,
              actualHash: transaction.hash,
            },
          ),
        );
    }

    previousHash = transaction.hash;
    count++;
  }

  return ok({ count });
};

export const rehashLog = async (
  fs: FileSystem,
  configSchema: ConfigSchema,
  nodeSchema: NodeSchema,
  path: string,
): ResultAsync<{ transactionsRehashed: number; backupPath: string }> => {
  if (!(await fs.exists(path)))
    return err(
      createError("file-not-found", "Transaction log file does not exist", {
        path,
      }),
    );

  const timestamp = getTimestampForFileName();
  const backupPath = path.replace(/\.jsonl$/, `-${timestamp}.jsonl.bac`);

  const renameResult = await fs.renameFile(path, backupPath);
  if (isErr(renameResult)) return renameResult;

  const clearResult = await clearLog(fs, path);
  if (isErr(clearResult)) return clearResult;

  let previousHash: TransactionHash = GENESIS_VERSION.hash;
  let transactionsRehashed = 0;

  for await (const result of readTransactionsFromBeginning(fs, backupPath)) {
    if (isErr(result)) return result;

    const tx = { ...result.data, previous: previousHash };
    const rehashedTx = await withHashTransaction(
      configSchema,
      nodeSchema,
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

/**
 * Facilitates writing to log files
 */

import type { Transaction } from "@binder/db";
import {
  createError,
  err,
  isErr,
  ok,
  okVoid,
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
  const statResult = await fs.stat(path);
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

const readTransactionsFromEnd = async function* (
  fs: FileSystem,
  path: string,
): AsyncGenerator<Result<Transaction>, void, unknown> {
  for await (const result of readLinesFromEnd(fs, path)) {
    if (isErr(result)) yield result;
    else yield ok(JSON.parse(result.data.line) as Transaction);
  }
};

export const logTransaction = async (
  fs: FileSystem,
  path: string,
  transaction: Transaction,
): ResultAsync<void> => {
  const json = JSON.stringify(transaction);
  return fs.appendFile(path, json + "\n");
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
): ResultAsync<void> => {
  const result = fs.writeFile(path, "");

  if (isErr(result))
    return err(
      createError("file-write-error", "Failed to clear transaction log", {
        path,
        error: result.error,
      }),
    );

  return okVoid;
};

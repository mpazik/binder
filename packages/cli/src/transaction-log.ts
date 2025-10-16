import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import type { Transaction } from "@binder/db";
import {
  createError,
  err,
  errorToObject,
  isErr,
  ok,
  type Result,
  tryCatch,
} from "@binder/utils";
import * as ui from "./ui.ts";

export const logTransaction = (
  transaction: Transaction,
  path: string,
): void => {
  const json = JSON.stringify(transaction);
  const result = tryCatch(
    () => appendFileSync(path, json + "\n"),
    errorToObject,
  );

  if (isErr(result)) {
    ui.error(`Failed to log transaction: ${result.error.message}`);
  }
};

export const readTransactionLog = (path: string): Result<Transaction[]> => {
  if (!existsSync(path)) return ok([]);

  const result = tryCatch(() => {
    const content = readFileSync(path, "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as Transaction);
  }, errorToObject);

  if (isErr(result))
    return err(
      createError("file-read-error", "Failed to read transaction log", {
        path,
        error: result.error,
      }),
    );

  return ok(result.data);
};

export const removeLastFromLog = (
  path: string,
  count: number,
): Result<Transaction[]> => {
  const readResult = readTransactionLog(path);
  if (isErr(readResult)) return readResult;

  const transactions = readResult.data;
  if (count > transactions.length)
    return err(
      createError(
        "invalid-count",
        `Cannot remove ${count} transactions, only ${transactions.length} available in log`,
      ),
    );

  const removed = transactions.slice(-count);
  const remaining = transactions.slice(0, -count);

  const writeResult = tryCatch(() => {
    const content = remaining.map((tx) => JSON.stringify(tx)).join("\n");
    writeFileSync(path, remaining.length > 0 ? content + "\n" : "");
  }, errorToObject);

  if (isErr(writeResult))
    return err(
      createError("file-write-error", "Failed to write transaction log", {
        path,
        error: writeResult.error,
      }),
    );

  return ok(removed);
};

export const clearTransactionLog = (path: string): Result<void> => {
  if (!existsSync(path)) return ok(undefined);

  const result = tryCatch(() => writeFileSync(path, ""), errorToObject);

  if (isErr(result))
    return err(
      createError("file-write-error", "Failed to clear transaction log", {
        path,
        error: result.error,
      }),
    );

  return ok(undefined);
};

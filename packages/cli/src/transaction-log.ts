import { appendFileSync } from "fs";
import type { Transaction } from "@binder/db";
import { errorToObject, isErr, tryCatch } from "@binder/utils";
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

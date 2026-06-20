import {
  GENESIS_VERSION,
  serializeTransaction,
  parseTransaction,
  type Transaction,
  type TransactionHash,
} from "@binder/repo";
import {
  appendLine,
  isErr,
  ok,
  okVoid,
  readLastLines,
  removeLastLines,
  type ResultAsync,
} from "@binder/utils";
import type { FileSystem } from "../../lib/filesystem.ts";

const tailHash = async (
  fs: FileSystem,
  txPath: string,
): ResultAsync<TransactionHash> => {
  const lastResult = await readLastLines(fs, txPath, 1, parseTransaction);
  if (isErr(lastResult)) return lastResult;
  const last = lastResult.data[0];
  return ok(last ? last.hash : GENESIS_VERSION.hash);
};

/**
 * Verifying commit handler: append the transaction to the tx-log iff
 * `tx.previous` matches the current tail hash. When the tail already equals
 * `tx.hash` (the transaction is already logged, e.g. repair re-applying a
 * log-only transaction) this is a no-op, keeping the handler idempotent.
 */
export const journalOnCommit = async (
  fs: FileSystem,
  txPath: string,
  tx: Transaction,
): ResultAsync<void> => {
  const tailResult = await tailHash(fs, txPath);
  if (isErr(tailResult)) return tailResult;
  if (tx.previous !== tailResult.data) return okVoid;

  return appendLine(fs, txPath, tx, serializeTransaction);
};

/**
 * Verifying rollback handler: walk the reverted transactions (newest-first)
 * and, for each one that matches the current tail hash, trim it from the
 * tx-log. Stops at the first non-match, so reverted transactions that were
 * never logged (e.g. repair rolling back a db-only transaction) are left
 * untouched.
 */
export const journalOnRollback = async (
  fs: FileSystem,
  txPath: string,
  transactions: Transaction[],
): ResultAsync<void> => {
  for (const tx of transactions) {
    const tailResult = await tailHash(fs, txPath);
    if (isErr(tailResult)) return tailResult;
    if (tailResult.data !== tx.hash) break;

    const removeResult = await removeLastLines(fs, txPath, 1);
    if (isErr(removeResult)) return removeResult;
  }
  return okVoid;
};

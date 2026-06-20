import { serializeTransaction, type Transaction } from "@binder/repo";
import { appendLines, clearLog, okVoid, type ResultAsync } from "@binder/utils";
import type { FileSystem } from "../../lib/filesystem.ts";

/**
 * Rollback handler: append the reverted transactions to the undo-log (redo
 * stack) so they can be replayed later via `binder redo`.
 */
export const undoOnRollback = async (
  fs: FileSystem,
  undoPath: string,
  transactions: Transaction[],
): ResultAsync<void> => {
  if (transactions.length === 0) return okVoid;
  return appendLines(fs, undoPath, transactions, serializeTransaction);
};

/**
 * Commit handler: a forward commit invalidates the redo stack. Clear the
 * undo-log unconditionally.
 */
export const undoOnCommit = async (
  fs: FileSystem,
  undoPath: string,
  _tx: Transaction,
): ResultAsync<void> => clearLog(fs, undoPath);

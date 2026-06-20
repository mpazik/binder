import { join } from "node:path";
import type { Argv } from "yargs";
import { fail, isErr, okVoid, readLastLines } from "@binder/utils";
import type { TransactionId } from "@binder/repo";
import { parseTransaction } from "@binder/repo";
import { type CommandHandlerWithDb, runtimeWithDb } from "../../runtime.ts";
import { UNDO_LOG_FILE } from "../../config.ts";
import { resolveTransactionDisplayKeys } from "../../cli/ui.ts";
import { types } from "../../cli/types.ts";

export const undoHandler: CommandHandlerWithDb<{
  steps: number;
}> = async (ctx) => {
  const { kg, ui, log, args } = ctx;
  if (args.steps < 1)
    return fail("invalid-steps", `Steps must be at least 1, got ${args.steps}`);

  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 0)
    return fail("invalid-undo", "Cannot undo the genesis transaction");

  if (args.steps > currentId)
    return fail(
      "invalid-undo",
      `Cannot undo ${args.steps} transactions, only ${currentId} available`,
    );

  // Fetch transactions being undone (for display).
  const transactionIds = Array.from(
    { length: args.steps },
    (_, index) => (currentId - index) as TransactionId,
  );
  const transactionsToUndo = [];
  for (const id of transactionIds) {
    const txResult = await kg.fetchTransaction(id);
    if (isErr(txResult)) return txResult;
    transactionsToUndo.push(txResult.data);
  }

  // Rollback — journal trims tx-log and undo plugin stages the redo stack,
  // both reactively via their subscriptions.
  const rollbackResult = await kg.rollback(args.steps, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  ui.heading(`Undoing ${args.steps} transaction(s)`);

  const resolved = await resolveTransactionDisplayKeys(kg, transactionsToUndo);
  for (const tx of resolved) {
    ui.printRawTransaction(tx, "full");
    ui.println("");
  }

  log.info("Undone successfully", { steps: args.steps });
  ui.block(() => {
    ui.success("Undone successfully");
    ui.info(
      `Use \`binder redo${args.steps > 1 ? ` ${args.steps}` : ""}\` to bring these changes back if needed`,
    );
  });
  return okVoid;
};

export const redoHandler: CommandHandlerWithDb<{
  steps: number;
}> = async (ctx) => {
  const { kg, config, ui, log, fs, args } = ctx;
  if (args.steps < 1)
    return fail("invalid-steps", `Steps must be at least 1, got ${args.steps}`);

  const undoLogPath = join(config.paths.data, UNDO_LOG_FILE);
  const undoLogResult = await readLastLines(
    fs,
    undoLogPath,
    args.steps,
    parseTransaction,
  );
  if (isErr(undoLogResult)) return undoLogResult;

  const undoLog = undoLogResult.data;
  if (undoLog.length === 0)
    return fail("empty-undo-log", "Nothing to redo: undo log is empty");

  if (args.steps > undoLog.length)
    return fail(
      "invalid-redo",
      `Cannot redo ${args.steps} transactions, only ${undoLog.length} available in undo log`,
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

  // Apply each — journal appends + undo plugin clears reactively.
  for (const tx of originalTransactions) {
    const applyResult = await kg.apply(tx);
    if (isErr(applyResult)) return applyResult;
  }

  ui.heading(`Redoing ${args.steps} transaction(s)`);

  const resolved = await resolveTransactionDisplayKeys(
    kg,
    originalTransactions,
  );
  for (const tx of resolved) {
    ui.printRawTransaction(tx, "full");
    ui.println("");
  }

  log.info("Redone successfully", { steps: args.steps });
  ui.block(() => {
    ui.success("Redone successfully");
  });
  return okVoid;
};

export const UndoCommand = types({
  command: "undo [steps]",
  describe: "undo the last N transactions",
  builder: (yargs: Argv) => {
    return yargs.positional("steps", {
      describe: "number of transactions to undo",
      type: "number",
      default: 1,
    });
  },
  handler: runtimeWithDb(undoHandler),
});

export const RedoCommand = types({
  command: "redo [steps]",
  describe: "redo the last N undone transactions",
  builder: (yargs: Argv) => {
    return yargs.positional("steps", {
      describe: "number of transactions to redo",
      type: "number",
      default: 1,
    });
  },
  handler: runtimeWithDb(redoHandler),
});

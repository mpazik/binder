import { join } from "path";
import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
import { readTransactionLog, removeLastFromLog } from "../transaction-log.ts";
import { UNDO_LOG_FILE } from "../config.ts";
import { renderDocs } from "../document/repository.ts";
import { types } from "./types.ts";

export const redoHandler: CommandHandlerWithDb<{
  steps: number;
}> = async ({ kg, ui, log, config, args }) => {
  if (args.steps < 1)
    return err(
      createError(
        "invalid-steps",
        `Steps must be at least 1, got ${args.steps}`,
      ),
    );

  const undoLogPath = join(config.paths.binder, UNDO_LOG_FILE);
  const undoLogResult = readTransactionLog(undoLogPath);
  if (isErr(undoLogResult)) return undoLogResult;

  const undoLog = undoLogResult.data;
  if (undoLog.length === 0)
    return err(
      createError("empty-undo-log", "Nothing to redo: undo log is empty"),
    );

  if (args.steps > undoLog.length)
    return err(
      createError(
        "invalid-redo",
        `Cannot redo ${args.steps} transactions, only ${undoLog.length} available in undo log`,
      ),
    );

  const transactionsToRedo = undoLog.slice(-args.steps).reverse();

  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentVersion = versionResult.data;
  const firstTxToRedo = transactionsToRedo[0];

  if (currentVersion.hash !== firstTxToRedo.previous)
    return err(
      createError(
        "version-mismatch",
        "Cannot redo: repository state has changed since undo",
      ),
    );

  ui.println("");
  ui.println(
    ui.Style.TEXT_INFO_BOLD +
      `Redoing ${args.steps} transaction(s):` +
      ui.Style.TEXT_NORMAL,
  );
  ui.println("");

  for (const tx of transactionsToRedo) {
    ui.printTransaction(tx);
  }

  ui.println("");

  for (const tx of transactionsToRedo) {
    const applyResult = await kg.apply(tx);
    if (isErr(applyResult)) return applyResult;
  }

  const removeResult = removeLastFromLog(undoLogPath, args.steps);
  if (isErr(removeResult)) return removeResult;

  const renderResult = await renderDocs(
    kg,
    config.paths.docs,
    config.dynamicDirectories,
  );
  if (isErr(renderResult)) {
    log.error("Failed to re-render docs after redo", {
      error: renderResult.error,
    });
  }

  log.info("Redone successfully", { steps: args.steps });
  ui.println(
    ui.Style.TEXT_SUCCESS + "✓ Redone successfully" + ui.Style.TEXT_NORMAL,
  );
  return ok(undefined);
};

const RedoCommand = types({
  command: "redo [steps]",
  describe: "redo the last N undone transactions",
  builder: (yargs: Argv) => {
    return yargs.positional("steps", {
      describe: "number of transactions to redo",
      type: "number",
      default: 1,
    });
  },
  handler: bootstrapWithDb(redoHandler),
});

export default RedoCommand;

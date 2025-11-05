import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { readLastTransactions, removeLastFromLog } from "../transaction-log.ts";
import { UNDO_LOG_FILE } from "../config.ts";
import { renderDocs } from "../document/repository.ts";
import { types } from "./types.ts";

export const redoHandler: CommandHandlerWithDbWrite<{
  steps: number;
}> = async ({ kg, ui, log, config, fs, args }) => {
  if (args.steps < 1)
    return err(
      createError(
        "invalid-steps",
        `Steps must be at least 1, got ${args.steps}`,
      ),
    );

  const undoLogResult = await readLastTransactions(
    fs,
    config.paths.binder,
    args.steps,
    UNDO_LOG_FILE,
  );

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

  const transactionsToRedo = undoLog.reverse();

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

  ui.heading(`Redoing ${args.steps} transaction(s)`);

  for (const tx of transactionsToRedo) {
    ui.printTransaction(tx);
    ui.println("");
  }

  for (const tx of transactionsToRedo) {
    const applyResult = await kg.apply(tx);
    if (isErr(applyResult)) return applyResult;
  }

  const removeResult = await removeLastFromLog(
    fs,
    config.paths.binder,
    args.steps,
    UNDO_LOG_FILE,
  );
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
  ui.block(() => {
    ui.success("Redone successfully");
  });
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
  handler: bootstrapWithDbWrite(redoHandler),
});

export default RedoCommand;

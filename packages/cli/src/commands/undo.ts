import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { undoTransactions } from "../lib/orchestrator.ts";
import { renderDocs } from "../document/repository.ts";
import { types } from "./types.ts";

export const undoHandler: CommandHandlerWithDbWrite<{
  steps: number;
}> = async ({ kg, ui, log, config, fs, args }) => {
  if (args.steps < 1)
    return err(
      createError(
        "invalid-steps",
        `Steps must be at least 1, got ${args.steps}`,
      ),
    );

  const undoResult = await undoTransactions(
    fs,
    kg,
    config.paths.binder,
    args.steps,
  );
  if (isErr(undoResult)) return undoResult;

  const transactionsToUndo = undoResult.data;

  ui.heading(`Undoing ${args.steps} transaction(s)`);

  for (const tx of transactionsToUndo) {
    ui.printTransaction(tx);
    ui.println("");
  }

  const renderResult = await renderDocs(
    kg,
    log,
    config.paths.docs,
    config.dynamicDirectories,
  );
  if (isErr(renderResult)) {
    log.error("Failed to re-render docs after undo", {
      error: renderResult.error,
    });
  }

  log.info("Undone successfully", { steps: args.steps });
  ui.block(() => {
    ui.success("Undone successfully");
    ui.info(
      `Use \`binder redo${args.steps > 1 ? ` ${args.steps}` : ""}\` to bring these changes back if needed`,
    );
  });
  return ok(undefined);
};

const UndoCommand = types({
  command: "undo [steps]",
  describe: "undo the last N transactions",
  builder: (yargs: Argv) => {
    return yargs.positional("steps", {
      describe: "number of transactions to undo",
      type: "number",
      default: 1,
    });
  },
  handler: bootstrapWithDbWrite(undoHandler),
});

export default UndoCommand;

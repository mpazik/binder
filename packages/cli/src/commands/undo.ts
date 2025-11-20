import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
import { undoTransactions } from "../lib/orchestrator.ts";
import { types } from "./types.ts";

export const undoHandler: CommandHandlerWithDb<{
  steps: number;
}> = async ({ db, ui, log, config, fs, args }) => {
  if (args.steps < 1)
    return err(
      createError(
        "invalid-steps",
        `Steps must be at least 1, got ${args.steps}`,
      ),
    );

  const undoResult = await undoTransactions(
    { db, fs, log, config },
    args.steps,
  );
  if (isErr(undoResult)) return undoResult;

  const transactionsToUndo = undoResult.data;

  ui.heading(`Undoing ${args.steps} transaction(s)`);

  for (const tx of transactionsToUndo) {
    ui.printTransaction(tx);
    ui.println("");
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
  handler: bootstrapWithDb(undoHandler),
});

export default UndoCommand;

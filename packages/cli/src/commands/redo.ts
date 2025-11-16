import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { redoTransactions } from "../lib/orchestrator.ts";
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

  const redoResult = await redoTransactions(
    fs,
    kg,
    config.paths.binder,
    args.steps,
  );
  if (isErr(redoResult)) return redoResult;

  const originalTransactions = redoResult.data;

  ui.heading(`Redoing ${args.steps} transaction(s)`);

  for (const tx of originalTransactions) {
    ui.printTransaction(tx);
    ui.println("");
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

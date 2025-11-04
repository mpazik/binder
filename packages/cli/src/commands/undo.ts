import type { Argv } from "yargs";
import { createError, err, isErr, ok } from "@binder/utils";
import type { Transaction, TransactionRef } from "@binder/db";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { logTransaction } from "../transaction-log.ts";
import { UNDO_LOG_FILE } from "../config.ts";
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

  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 1)
    return err(
      createError("invalid-undo", "Cannot undo the genesis transaction"),
    );

  if (args.steps > currentId - 1)
    return err(
      createError(
        "invalid-undo",
        `Cannot undo ${args.steps} transactions, only ${currentId - 1} available`,
      ),
    );

  const transactionsToUndo: Transaction[] = [];
  for (let i = 0; i < args.steps; i++) {
    const txId = (currentId - i) as TransactionRef;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToUndo.push(txResult.data);
  }

  ui.println("");
  ui.println(
    ui.Style.TEXT_WARNING_BOLD +
      `Undoing ${args.steps} transaction(s):` +
      ui.Style.TEXT_NORMAL,
  );
  ui.println("");

  for (const tx of transactionsToUndo) {
    ui.printTransaction(tx);
  }

  ui.println("");

  const rollbackResult = await kg.rollback(args.steps, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  for (const tx of transactionsToUndo) {
    await logTransaction(fs, config.paths.binder, tx, UNDO_LOG_FILE);
  }

  const renderResult = await renderDocs(
    kg,
    config.paths.docs,
    config.dynamicDirectories,
  );
  if (isErr(renderResult)) {
    log.error("Failed to re-render docs after undo", {
      error: renderResult.error,
    });
  }

  log.info("Undone successfully", { steps: args.steps });
  ui.println(
    ui.Style.TEXT_SUCCESS + "✓ Undone successfully" + ui.Style.TEXT_NORMAL,
  );
  ui.println(
    ui.Style.TEXT_INFO +
      `ℹ Use \`binder redo${args.steps > 1 || ` ${args.steps}`}\` to bring these changes back if needed` +
      ui.Style.TEXT_NORMAL,
  );
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

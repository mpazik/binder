#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { isErr, tryCatch } from "@binder/utils";
import InitCommand from "./commands/init.ts";
import NodeCommand from "./commands/node";
import ConfigCommand from "./commands/config.ts";
import TransactionCommand from "./commands/transaction.ts";
import { SearchCommand } from "./commands/search.ts";
import DocsCommand from "./commands/docs.ts";
import DevCommand from "./commands/dev.ts";
import UndoCommand from "./commands/undo.ts";
import RedoCommand from "./commands/redo.ts";
import McpCommand from "./commands/mcp.ts";
import LspCommand from "./commands/lsp.ts";
import * as UI from "./ui";
import { BINDER_VERSION, isDevMode } from "./build-time";
import { LOG_LEVELS } from "./log.ts";

let cli = yargs(hideBin(process.argv))
  .scriptName("binder")
  .help("help", "show help")
  .version("version", "show version number", BINDER_VERSION)
  .alias("version", "v")
  .completion("completion", "generate bash/zsh completion script")
  .exitProcess(false)
  .option("cwd", {
    describe: "working directory to run command in",
    type: "string",
    alias: "C",
  })
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
    default: false,
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: LOG_LEVELS,
  })
  .usage(UI.logo())
  .wrap(null)
  .command(InitCommand)
  .command(NodeCommand)
  .command(ConfigCommand)
  .command(TransactionCommand)
  .command(SearchCommand)
  .command(DocsCommand)
  .command(UndoCommand)
  .command(RedoCommand)
  .command(McpCommand)
  .command(LspCommand);

if (isDevMode()) {
  cli = cli.command(DevCommand);
}

cli = cli
  .demandCommand(1, "You need to specify a command")
  .fail((msg) => {
    if (msg) {
      UI.error(msg);
      cli.showHelp("log");
    }
    process.exit(1);
  })
  .strict();

const result = tryCatch(() => cli.parse());
if (isErr(result)) {
  console.error("fatal", result.error);
  process.exitCode = 1;
}

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
import * as UI from "./ui";
import { BINDER_VERSION, isDev } from "./build-time";

const cancel = new AbortController();

process.on("unhandledRejection", (e) => {
  console.error("rejection", {
    e: e instanceof Error ? e.message : e,
  });
});

process.on("uncaughtException", (e) => {
  console.error("exception", {
    e: e.message,
  });
});

let cli = yargs(hideBin(process.argv))
  .scriptName("binder")
  .help("help", "show help")
  .version("version", "show version number", BINDER_VERSION)
  .alias("version", "v")
  .completion("completion", "generate bash/zsh completion script")
  .exitProcess(false)
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
    default: false,
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"] as const,
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
  .command(McpCommand);

if (isDev()) {
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

const result = tryCatch<void, any>(() => cli.parse());
if (isErr(result)) {
  const e = result.error;
  if (e instanceof Error) {
    console.error("fatal", {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    });
  } else if (e instanceof ResolveMessage) {
    console.error("fatal", {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    });
  } else {
    console.error("fatal", { error: e });
  }
  process.exitCode = 1;
}

cancel.abort();

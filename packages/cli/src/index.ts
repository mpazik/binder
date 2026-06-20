#!/usr/bin/env node
import { join } from "node:path";
import yargs from "yargs";
import type { CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";
import { isErr, tryCatch } from "@binder/utils";
import { InitCommand } from "./commands/init.ts";
import { CreateCommand } from "./commands/create.ts";
import { ReadCommand } from "./commands/read.ts";
import { UpdateCommand } from "./commands/update.ts";
import { DeleteCommand } from "./commands/delete.ts";
import { SchemaCommand } from "./commands/schema.ts";
import { TransactionCommand } from "./commands/transaction.ts";
import { SearchCommand } from "./commands/search.ts";
import { DocsCommand } from "./commands/docs.ts";
import { DevCommand } from "./commands/dev.ts";

import { McpCommand } from "./commands/mcp.ts";
import { HttpCommand } from "./commands/http.ts";
import { LspCommand } from "./commands/lsp.ts";
import { LocateCommand } from "./commands/locate.ts";
import { createRunCommand } from "./commands/run.ts";
import { findBinderRoot, BINDER_DIR } from "./config.ts";
import { findScript } from "./lib/scripts.ts";
import { createUi, logo } from "./cli/ui.ts";
import { BINDER_VERSION, isDevMode } from "./environment.ts";
import { LOG_LEVELS } from "./log.ts";
import { checkForUpdate } from "./lib/update-check.ts";
import { groupOptions, runWithFormattedHelp } from "./cli/help.ts";
import { journalPlugin } from "./plugins/journal/index.ts";
import { undoPlugin } from "./plugins/undo/index.ts";
import { loadWorkspacePluginCommands } from "./lib/workspace-plugins.ts";

const ui = createUi();

const rawArgv = hideBin(process.argv);

const collectCommandNames = (
  commands: Pick<CommandModule, "command" | "aliases">[],
): Set<string> => {
  // Always-available pseudo-commands not in the command list.
  const names = new Set(["run", "help", "completion"]);
  for (const cmd of commands) {
    const cmdStr =
      typeof cmd.command === "string"
        ? cmd.command
        : Array.isArray(cmd.command)
          ? (cmd.command[0] ?? "")
          : "";
    const first = cmdStr.split(/\s+/)[0];
    if (first) names.add(first);
    const { aliases } = cmd;
    if (typeof aliases === "string") names.add(aliases);
    else if (Array.isArray(aliases)) {
      for (const a of aliases) names.add(a);
    }
  }
  return names;
};

type CmdMeta = Pick<CommandModule, "command" | "aliases">;

// Built-in commands registered with yargs. The list is also used to detect
// shadowed names during bare-dispatch and in `binder run` listings.
const coreCommands: CmdMeta[] = [
  InitCommand,
  CreateCommand,
  ReadCommand,
  UpdateCommand,
  DeleteCommand,
  SchemaCommand,
  TransactionCommand,
  SearchCommand,
  DocsCommand,
  McpCommand,
  HttpCommand,
  LspCommand,
  LocateCommand,
];
if (isDevMode()) coreCommands.push(DevCommand);

// Lazily computed; populated after all dynamic commands are registered.
let builtInNamesCache: Set<string> | undefined;
const getBuiltInNames = (): Set<string> => {
  if (!builtInNamesCache) builtInNamesCache = collectCommandNames(allCommands);
  return builtInNamesCache;
};

let cli = yargs()
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
  .option("quiet", {
    describe:
      "suppress non-essential output (auto-enabled for non-pretty formats)",
    type: "boolean",
    alias: "q",
    default: false,
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
  .usage(logo())
  .wrap(null)
  .command(InitCommand)
  .command(CreateCommand)
  .command(ReadCommand)
  .command(UpdateCommand)
  .command(DeleteCommand)
  .command(SchemaCommand)
  .command(TransactionCommand)
  .command(SearchCommand)
  .command(DocsCommand)
  .command(McpCommand)
  .command(HttpCommand)
  .command(LspCommand)
  .command(LocateCommand)
  .command(createRunCommand(getBuiltInNames));

cli = groupOptions(cli);

if (isDevMode()) cli = cli.command(DevCommand);

// Dynamic commands from plugins and workspace config.
const allCommands: CmdMeta[] = [...coreCommands];
for (const cmd of journalPlugin().commands ?? []) {
  cli = cli.command(cmd);
  allCommands.push(cmd);
}
for (const cmd of undoPlugin().commands ?? []) {
  cli = cli.command(cmd);
  allCommands.push(cmd);
}
for (const cmd of await loadWorkspacePluginCommands()) {
  cli = cli.command(cmd);
  allCommands.push(cmd);
}

// Bare-dispatch: if the first arg is a non-builtin command name and a workspace
// script with that name exists, rewrite argv to invoke `binder run <name>`.
const builtInNames = getBuiltInNames();
let effectiveArgv = rawArgv;
const firstArg = rawArgv[0];
if (
  firstArg &&
  firstArg.length > 0 &&
  !firstArg.startsWith("-") &&
  !builtInNames.has(firstArg)
) {
  const rootResult = await findBinderRoot();
  if (!isErr(rootResult) && rootResult.data) {
    const scriptsDir = join(rootResult.data, BINDER_DIR, "scripts");
    const entry = await findScript(scriptsDir, firstArg);
    if (entry) effectiveArgv = ["run", ...rawArgv];
  }
}

cli = cli
  .demandCommand(1, "You need to specify a command")
  .fail((msg) => {
    if (msg) {
      ui.error(msg);
      cli.showHelp("log");
    }
    process.exit(1);
  })
  .strict();

const result = await tryCatch(async () =>
  runWithFormattedHelp(async () => cli.parse(effectiveArgv)),
);
if (isErr(result)) {
  console.error("fatal", result.error);
  process.exitCode = 1;
}

await checkForUpdate(BINDER_VERSION);
export { isFormatCompatibleWithPosition } from "./document/field-slot.ts";
export type { SlotPosition } from "./document/field-slot.ts";

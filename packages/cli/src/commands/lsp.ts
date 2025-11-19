import type { Argv } from "yargs";
import { ok } from "@binder/utils";
import { bootstrapMinimal, type CommandHandlerMinimal } from "../runtime.ts";
import { BINDER_VERSION } from "../build-time.ts";
import { createLspServer } from "../lsp";
import { types } from "./types.ts";

const lspHandler: CommandHandlerMinimal = async ({ log, fs, globalConfig }) => {
  log.info("LSP server starting", {
    version: BINDER_VERSION,
  });

  const connection = createLspServer({ log, fs, globalConfig });

  const cleanup = () => {
    log.info("LSP server stopping");
    connection.dispose();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise(() => {});
  return ok(undefined);
};

const LspCommand = types({
  command: "lsp",
  describe: "start LSP server over stdio",
  builder: (yargs: Argv) => {
    return yargs.epilogue(`
LSP Server for Binder

This command starts a Language Server Protocol server that provides
real-time synchronization of Binder documents with the knowledge graph.

FEATURES:
  - Automatic sync on file save
  - Error reporting via diagnostics
  - Fix suggestions
  - Supports both markdown and YAML files

SETUP:
Please read documentation to setup Binder with your editor
    `);
  },
  handler: bootstrapMinimal(lspHandler, { logFile: "lsp.log", silent: true }),
});

export default LspCommand;

import type { Argv } from "yargs";
import {
  createJsonRpcError,
  createJsonRpcErrorResponse,
  isErr,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JSONRPC_ERRORS,
  type JsonRpcResponse,
  ok,
  tryCatch,
} from "@binder/utils";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { BINDER_VERSION } from "../environment.ts";
import { processMcpRequest } from "../mcp";
import { track, forceFlush } from "../telemetry.ts";
import { types } from "../cli/types.ts";

const respond = (response: JsonRpcResponse) => {
  process.stdout.write(JSON.stringify(response) + "\n");
};

const mcpHandler: CommandHandlerWithDb = async ({
  kg,
  log,
  config,
  fs,
  telemetry,
}) => {
  const startedAt = Date.now();
  process.env.NO_COLOR = "1";

  log.info("MCP server starting", {
    version: BINDER_VERSION,
    cwd: config.paths.root,
  });

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parseResult = tryCatch(() => JSON.parse(trimmed));

    if (isErr(parseResult)) {
      respond(
        createJsonRpcErrorResponse(
          createJsonRpcError(JSONRPC_ERRORS.PARSE_ERROR, "Parse error"),
          null,
        ),
      );
      return;
    }

    const request = parseResult.data;

    if (!isJsonRpcRequest(request)) {
      respond(
        createJsonRpcErrorResponse(
          createJsonRpcError(
            JSONRPC_ERRORS.INVALID_REQUEST,
            "Invalid JSON-RPC request",
          ),
          null,
        ),
      );
      return;
    }

    if (isJsonRpcNotification(request)) {
      log.debug("Received notification", { method: request.method });
      return;
    }

    const response = await processMcpRequest({ kg, log, config, fs }, request);

    if (request.method === "tools/call") {
      const params = request.params as { name?: unknown } | null;
      const tool = typeof params?.name === "string" ? params.name : null;

      if (tool === "search" || tool === "schema" || tool === "transact") {
        track(telemetry, {
          event: "mcp_tool",
          tool,
          success: !("error" in response),
        });
      }
    }

    respond(response);
  });

  rl.on("close", () => {
    log.info("MCP server stopping");

    track(telemetry, {
      event: "mcp_session",
      duration_ms: Date.now() - startedAt,
    });

    forceFlush(telemetry, { projectRoot: config.paths.root });

    process.exit(0);
  });

  process.on("SIGINT", () => {
    log.info("MCP server interrupted");
    rl.close();
  });

  process.on("SIGTERM", () => {
    log.info("MCP server terminated");
    rl.close();
  });

  await new Promise(() => {});
  return ok(undefined);
};

export const McpCommand = types({
  command: "mcp",
  describe: "start MCP server over stdio",
  builder: (yargs: Argv) => {
    return yargs.epilogue(`
MCP Server for Binder

This command starts a Model Context Protocol server that exposes
Binder's knowledge graph capabilities to AI assistants.

SETUP WITH CLAUDE DESKTOP:

Add to ~/Library/Application Support/Claude/claude_desktop_config.json:

{
  "mcpServers": {
    "binder": {
      "command": "binder",
      "args": ["mcp"],
      "cwd": "/path/to/your/binder/workspace"
    }
  }
}

AVAILABLE TOOLS:
  - search: Search the knowledge graph with filters
  - get-schema: Retrieve record schema definitions
    `);
  },
  handler: runtimeWithDb(mcpHandler, {
    logFile: "mcp.log",
    silent: true,
    telemetryInterface: "mcp",
  }),
});

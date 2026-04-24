import { resolve } from "path";
import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";
import { startHttpServer } from "../http/index.ts";

const DEFAULT_PORT = 4000;
const DEFAULT_HOST = "127.0.0.1";

type HttpArgs = {
  port?: number;
  host?: string;
  // string = path, false = --no-static (yargs negation), undefined = not set
  static?: string | false;
};

const httpHandler: CommandHandlerWithDb<HttpArgs> = async ({
  kg,
  log,
  config,
  fs,
  ui,
  args,
}) => {
  const userConfig = (config as Record<string, unknown>).http as
    | { port?: number; host?: string; static?: string }
    | undefined;

  const port = args.port ?? userConfig?.port ?? DEFAULT_PORT;
  const host = args.host ?? userConfig?.host ?? DEFAULT_HOST;

  // Resolve static dir:
  //   --no-static  → null (disabled)
  //   --static dir → absolute path (warn if missing)
  //   config       → absolute path
  //   default      → undefined (use built-in)
  let staticDir: string | null | undefined;

  if (args.static === false) {
    staticDir = null;
  } else if (args.static) {
    staticDir = resolve(config.paths.root, args.static);
  } else if (userConfig?.static) {
    staticDir = resolve(config.paths.root, userConfig.static);
  } else {
    staticDir = undefined; // fall back to built-in inside startHttpServer
  }

  const result = await startHttpServer(
    { port, host, staticDir },
    { kg, log, config, fs },
  );

  if (isErr(result)) return result;

  const { stop } = result.data;

  const url = `http://${host}:${port}`;
  log.info(`HTTP server listening on ${url}`);
  ui.info(`Listening on ${url}`);

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      log.info("HTTP server stopping");
      await stop();
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return ok(undefined);
};

export const HttpCommand = types({
  command: "http",
  describe: "start HTTP server with JSON-RPC API and record browser",
  builder: (yargs: Argv) => {
    return yargs
      .option("port", {
        describe: `port to listen on (default: ${DEFAULT_PORT})`,
        type: "number",
        alias: "p",
      })
      .option("host", {
        describe: `host to bind to (default: ${DEFAULT_HOST})`,
        type: "string",
      })
      .option("static", {
        describe:
          "directory to serve static files from (default: built-in record browser)",
        type: "string",
      });
    // --no-static is the yargs auto-negation of --static (sets static: false)
  },
  handler: runtimeWithDb(httpHandler, {
    logFile: "http.log",
    telemetryInterface: "cli",
  }),
});

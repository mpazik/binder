import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { isErr, tryCatch } from "@binder/utils";
import { RunCommand } from "./commands/run";
import { Log } from "./log";
import * as UI from "./ui";

const cancel = new AbortController();

process.on("unhandledRejection", (e) => {
  Log.error("rejection", {
    e: e instanceof Error ? e.message : e,
  });
});

process.on("uncaughtException", (e) => {
  Log.error("exception", {
    e: e.message,
  });
});

const version = "0.0.0";
const cli = yargs(hideBin(process.argv))
  .scriptName("binder-cli")
  .help("help", "show help")
  .version("version", "show version number", version)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    Log.info("binder-cli", {
      version: version,
      args: process.argv.slice(2),
    });
  })
  .usage("\n" + UI.logo())
  .command(RunCommand)
  .fail((msg) => {
    if (
      msg.startsWith("Unknown argument") ||
      msg.startsWith("Not enough non-option arguments") ||
      msg.startsWith("Invalid values:")
    ) {
      cli.showHelp("log");
    }
    process.exit(1);
  })
  .strict();

const result = await tryCatch<void, any>(() => cli.parse());
if (isErr(result)) {
  const data: Record<string, any> = {};
  const e = result.error;
  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    });
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    });
  }
  Log.error("fatal", data);
  process.exitCode = 1;
}

cancel.abort();

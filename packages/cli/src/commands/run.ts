import { join } from "node:path";
import process from "node:process";
import type { Argv } from "yargs";
import { fail, okVoid } from "@binder/utils";
import { type CommandHandler, runtime } from "../runtime.ts";
import { types } from "../cli/types.ts";
import { discoverScripts, runScript } from "../lib/scripts.ts";

const SCRIPTS_DIR_NAME = "scripts";

const padRight = (s: string, width: number): string =>
  s + " ".repeat(Math.max(0, width - s.length));

const makeRunHandler =
  (
    getBuiltInNames: () => Set<string>,
  ): CommandHandler<{
    name?: string;
    rest: string[];
  }> =>
  async ({ config, ui, args }) => {
    const scriptsDir = join(config.paths.binder, SCRIPTS_DIR_NAME);
    const { scripts, conflicts } = await discoverScripts(scriptsDir);
    const shadowed = getBuiltInNames();

    if (!args.name) {
      if (scripts.length === 0 && conflicts.length === 0) {
        ui.println("No scripts found");
        return okVoid;
      }
      const allNames = [
        ...scripts.map((s) => s.name),
        ...conflicts.map((c) => c.name),
      ];
      const width = Math.max(...allNames.map((n) => n.length), 0);
      for (const s of scripts) {
        const tag = shadowed.has(s.name) ? "  (shadowed)" : "";
        ui.println(`${padRight(s.name, width)}  ${s.path}${tag}`);
      }
      for (const c of conflicts) {
        ui.println(
          `${padRight(c.name, width)}  (conflict: ${c.paths.join(", ")})`,
        );
      }
      return okVoid;
    }

    const conflict = conflicts.find((c) => c.name === args.name);
    if (conflict) {
      return fail(
        "script-conflict",
        `Multiple scripts named '${args.name}': ${conflict.paths.join(", ")}. Remove duplicates to disambiguate.`,
        { data: { name: args.name, paths: conflict.paths } },
      );
    }

    const entry = scripts.find((s) => s.name === args.name);
    if (!entry) {
      return fail(
        "script-not-found",
        `No script named '${args.name}' in ${scriptsDir}`,
        { data: { name: args.name, scriptsDir } },
      );
    }

    const exitCode = await runScript({
      entry,
      args: args.rest,
      cwd: config.paths.root,
      env: { ...process.env, BINDER_WORKSPACE: config.paths.root },
    });
    process.exit(exitCode);
  };

export const createRunCommand = (getBuiltInNames: () => Set<string>) =>
  types({
    command: "run [name] [rest..]",
    describe: "list or execute workspace scripts",
    builder: (yargs: Argv) =>
      yargs
        .positional("name", {
          describe: "script name (omit to list all scripts)",
          type: "string",
        })
        .positional("rest", {
          describe: "arguments forwarded to the script",
          type: "string",
          array: true,
          default: [],
        })
        // Treat everything after the script name as raw script argv.
        // Without this, yargs would consume flags meant for the script.
        .parserConfiguration({ "unknown-options-as-args": true }),
    handler: runtime(makeRunHandler(getBuiltInNames)),
  });

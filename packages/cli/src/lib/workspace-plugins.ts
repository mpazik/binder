import type { CommandModule } from "yargs";
import { isErr, tryCatch } from "@binder/utils";
import { loadWorkspaceConfig } from "@binder/repo/local";
import { findBinderRoot } from "../config.ts";
import { createRealFileSystem } from "./filesystem.ts";

// Loads yargs commands contributed by user plugins declared in the workspace
// config. Called at CLI parse time (before any command runs) so help output
// shows plugin commands. Errors are logged and skipped — a broken plugin
// should not block the core CLI. `register()` happens later via `openRepo`.
export const loadWorkspacePluginCommands = async (): Promise<
  CommandModule[]
> => {
  const commands: CommandModule[] = [];
  const fs = createRealFileSystem();

  const rootResult = await findBinderRoot(fs);
  if (isErr(rootResult)) {
    console.warn(`[plugins] workspace discovery failed: ${rootResult.error}`);
    return commands;
  }
  if (!rootResult.data) return commands;
  const root = rootResult.data;

  const cfgResult = await loadWorkspaceConfig(root);
  if (isErr(cfgResult)) {
    console.warn(`[plugins] config load failed: ${cfgResult.error}`);
    return commands;
  }
  const specs = cfgResult.data.plugins ?? [];

  for (const spec of specs) {
    const name = typeof spec === "string" ? spec : spec.name;
    if (typeof spec !== "string" && spec.enabled === false) continue;
    const pluginConfig = typeof spec === "string" ? undefined : spec.config;

    const loaded = await tryCatch(async () => {
      const mod: { default?: unknown } = await import(name);
      const exp = (mod.default ?? mod) as unknown;
      const plugin =
        typeof exp === "function"
          ? (exp as (c: unknown) => { commands?: CommandModule[] })(
              pluginConfig,
            )
          : (exp as { commands?: CommandModule[] });
      return plugin.commands ?? [];
    });
    if (isErr(loaded)) {
      console.warn(`[plugins] failed to load '${name}': ${loaded.error}`);
      continue;
    }
    commands.push(...loaded.data);
  }

  return commands;
};

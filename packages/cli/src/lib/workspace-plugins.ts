import type { CommandModule } from "yargs";
import { isErr, tryCatch } from "@binder/utils";
import { loadWorkspaceConfig } from "@binder/repo/local";
import { findBinderRoot } from "../config.ts";

// Loads yargs commands from user plugins declared in the workspace config.
// Runs at CLI parse time (before logging exists) so help output shows plugin
// commands. Errors are logged to stderr and skipped — a broken plugin should
// not block the core CLI. Full `register()` happens later via `openRepo`.
export const loadWorkspacePluginCommands = async (): Promise<
  CommandModule[]
> => {
  const rootResult = await findBinderRoot();
  if (isErr(rootResult)) {
    console.warn(`[plugins] workspace discovery failed: ${rootResult.error}`);
    return [];
  }
  if (!rootResult.data) return [];

  const cfgResult = await loadWorkspaceConfig(rootResult.data);
  if (isErr(cfgResult)) {
    console.warn(`[plugins] config load failed: ${cfgResult.error}`);
    return [];
  }
  const specs = cfgResult.data.plugins ?? [];

  const commands: CommandModule[] = [];
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

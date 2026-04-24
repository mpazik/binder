import { spawn } from "node:child_process";
import type {
  BinderRepoPlugin,
  PluginModuleExport,
  PluginRepo,
} from "./plugin.ts";
import type { HookSpec, PluginSpec } from "./config.ts";

type NormalizedSpec = {
  name: string;
  pluginConfig?: unknown;
};

const normalize = (spec: PluginSpec): NormalizedSpec | null => {
  if (typeof spec === "string") return { name: spec };
  if (spec.enabled === false) return null;
  return { name: spec.name, pluginConfig: spec.config };
};

// TODO: handle CJS/ESM interop. For now assume default export or module-as-plugin.
const instantiate = (mod: unknown, pluginConfig: unknown): BinderRepoPlugin => {
  const exp =
    (mod as { default?: PluginModuleExport }).default ??
    (mod as PluginModuleExport);
  if (typeof exp === "function") return exp(pluginConfig);
  return exp as BinderRepoPlugin;
};

// FIXME: relative specifiers need resolving against workspace root.
// FIXME: wrap errors with better diagnostics.
export const loadPlugin = async (
  name: string,
  pluginConfig: unknown,
): Promise<BinderRepoPlugin> => {
  const mod = await import(name);
  return instantiate(mod, pluginConfig);
};

export const loadPluginsFromConfig = async (
  specs: PluginSpec[] | undefined,
): Promise<Array<{ plugin: BinderRepoPlugin; pluginConfig?: unknown }>> => {
  if (!specs) return [];
  const out: Array<{ plugin: BinderRepoPlugin; pluginConfig?: unknown }> = [];
  for (const spec of specs) {
    const norm = normalize(spec);
    if (!norm) continue;
    const plugin = await loadPlugin(norm.name, norm.pluginConfig);
    out.push({ plugin, pluginConfig: norm.pluginConfig });
  }
  return out;
};

// Runs command per commit, feeds tx JSON on stdin. Failures logged, not fatal.
export const hooksToPlugin = (hooks: HookSpec[]): BinderRepoPlugin => ({
  name: "__inline_hooks__",
  register({ repo }: { repo: PluginRepo }) {
    for (const hook of hooks) {
      repo.onTransaction(undefined, async (tx: unknown) => {
        // TODO: capture stdout/stderr into repo log.
        return new Promise<void>((resolve) => {
          const child = spawn(hook.command, {
            shell: true,
            stdio: ["pipe", "inherit", "inherit"],
          });
          child.stdin.write(JSON.stringify(tx));
          child.stdin.end();
          child.on("exit", () => resolve());
        });
      });
    }
  },
});

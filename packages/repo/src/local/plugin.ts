import type { Repo } from "./open.ts";

// Uses `any` for all generic params — plugins are schema-agnostic.
export type PluginRepo = Repo<any, any, any>;

// Consumers may extend this with additional fields (e.g. command definitions).
export type BinderRepoPlugin = {
  name: string;
  register?(ctx: {
    repo: PluginRepo;
    pluginConfig?: unknown;
  }): void | Promise<void>;
  dispose?(): void | Promise<void>;
};

export type PluginModuleExport<P extends BinderRepoPlugin = BinderRepoPlugin> =
  | P
  | ((pluginConfig?: unknown) => P);

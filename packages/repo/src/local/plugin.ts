import type { Repo } from "./open.ts";

// Uses `any` for all generic params — plugins are schema-agnostic.
export type PluginRepo = Repo<any, any, any>;

// Third-party packages extend this (e.g. BinderCliPlugin adds `commands`).
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

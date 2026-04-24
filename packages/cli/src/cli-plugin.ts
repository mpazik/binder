import type { CommandModule } from "yargs";
import type { BinderRepoPlugin } from "@binder/repo/local";

export type BinderCliPlugin = BinderRepoPlugin & {
  commands?: CommandModule[];
};

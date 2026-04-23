import { join } from "node:path";
import { homedir } from "node:os";
import { BINDER_DIR, DATA_DIR } from "./constants.ts";

export type WorkspacePaths = {
  root: string;
  binder: string;
  data: string;
};

export const resolveWorkspacePaths = (
  root: string,
  binderDir: string = BINDER_DIR,
): WorkspacePaths => {
  const binder = join(root, binderDir);
  return {
    root,
    binder,
    data: join(binder, DATA_DIR),
  };
};

/** Resolve the global config directory, honoring `$XDG_CONFIG_HOME`. */
export const getGlobalConfigPath = (): string => {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "binder");
};

/** Resolve the global state directory, honoring `$XDG_STATE_HOME`. */
export const getGlobalStatePath = (): string => {
  const stateHome =
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
  return join(stateHome, "binder");
};

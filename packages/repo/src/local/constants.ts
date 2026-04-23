export const BINDER_DIR = ".binder";
export const DATA_DIR = "data";
export const CONFIG_FILE = "config.yaml";
export const DB_FILE = "binder.db";

/** Falls back to the OS username (matching git behavior). Returns `"anonymous"` when none are set. */
export const getDefaultAuthor = (): string =>
  process.env.USER ||
  process.env.USERNAME ||
  process.env.LOGNAME ||
  "anonymous";

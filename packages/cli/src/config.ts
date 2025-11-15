import { dirname, join, resolve } from "path";
import { z } from "zod";
import { ok, type ResultAsync } from "@binder/utils";
import type { FileSystem } from "./lib/filesystem.ts";

const DEFAULT_DOCS_DIR = "./docs";
const DEFAULT_AUTHOR = "cli-user";
export const DEFAULT_DOCS_PATH = "docs";
export const CONFIG_FILE = "config.yaml";
export const NAVIGATION_FILE = "navigation.yaml";
export const BINDER_DIR = ".binder";
export const DB_FILE = "binder.db";
export const TRANSACTION_LOG_FILE = "transactions.jsonl";
export const UNDO_LOG_FILE = "undo.jsonl";
export const LOCK_FILE = "lock";
export const LOCK_RETRY_DELAY_MS = 200;
export const LOCK_MAX_RETRIES = 3;

export const BinderConfigSchema = z.object({
  author: z.string().default(DEFAULT_AUTHOR),
  docsPath: z.string().default(DEFAULT_DOCS_DIR),
});

export type BinderConfig = z.infer<typeof BinderConfigSchema>;

export const findBinderRoot = async (
  fs: FileSystem,
  startPath?: string,
): ResultAsync<string | null> => {
  let currentPath = resolve(startPath ?? process.cwd());
  const root = resolve("/");

  while (currentPath !== root) {
    const binderDirPath = join(currentPath, BINDER_DIR);

    if (await fs.exists(binderDirPath)) {
      return ok(currentPath);
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return ok(null);
};

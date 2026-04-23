import { dirname, join, resolve } from "path";
import { z } from "zod";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import {
  CoreConfigSchema,
  getGlobalConfigPath,
  getGlobalStatePath as repoGetGlobalStatePath,
  loadGlobalConfig as repoLoadGlobalConfig,
  loadWorkspaceConfig as repoLoadWorkspaceConfig,
  saveGlobalConfig as repoSaveGlobalConfig,
  BINDER_DIR as REPO_BINDER_DIR,
  CONFIG_FILE as REPO_CONFIG_FILE,
  DATA_DIR as REPO_DATA_DIR,
  DB_FILE as REPO_DB_FILE,
} from "@binder/repo/local";
import type { FileSystem } from "./lib/filesystem.ts";
import { LOG_LEVELS, type LogLevel } from "./log.ts";
import { isDevMode } from "./environment.ts";

export const DEFAULT_DOCS_PATH = isDevMode() ? "docs-dev" : ".";
export const CONFIG_FILE = REPO_CONFIG_FILE;
export const BINDER_DIR = isDevMode() ? ".binder-dev" : REPO_BINDER_DIR;

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/.*/**",
  "**/.DS_Store",
];
export const DB_FILE = REPO_DB_FILE;
export const TRANSACTION_LOG_FILE = "transactions.jsonl";
export const UNDO_LOG_FILE = "undo.jsonl";
export const LOCK_FILE = "lock";
export const DATA_DIR = REPO_DATA_DIR;
export const BACKUPS_DIR = "backups";
export const LOCK_RETRY_DELAY_MS = 200;
export const LOCK_MAX_RETRIES = 3;

/** Complete schema for the CLI's global config file. Extends core. */
export const cliGlobalConfigSchema = CoreConfigSchema.extend({
  logLevel: z.enum(LOG_LEVELS).optional(),
  telemetry: z.boolean().nullable().optional(),
});

export type GlobalConfig = z.infer<typeof cliGlobalConfigSchema>;

/** Complete schema for the CLI's workspace config file. Extends core. */
export const cliWorkspaceConfigSchema = CoreConfigSchema.extend({
  logLevel: z.enum(LOG_LEVELS).optional(),
  docsPath: z.string().default(DEFAULT_DOCS_PATH),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  validation: z
    .object({
      rules: z
        .record(z.string(), z.enum(["error", "warning", "info", "hint", "off"]))
        .optional(),
    })
    .optional(),
});

export type UserConfig = z.infer<typeof cliWorkspaceConfigSchema>;

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

export type ConfigPaths = {
  root: string;
  binder: string;
  data: string;
  backups: string;
  docs: string;
};

export const resolveRelativePath = (
  relativePath: string,
  paths: ConfigPaths,
): string => {
  const base = relativePath.startsWith(BINDER_DIR) ? paths.root : paths.docs;
  return join(base, relativePath);
};

export type AppConfig = {
  author: string;
  logLevel?: LogLevel;
  paths: ConfigPaths;
  include?: string[];
  exclude?: string[];
  validation?: {
    rules?: Record<string, "error" | "warning" | "info" | "hint" | "off">;
  };
};

export { getGlobalConfigPath };
export const getGlobalStatePath = repoGetGlobalStatePath;

export const loadGlobalConfig = (): ResultAsync<GlobalConfig> =>
  repoLoadGlobalConfig({ configSchema: cliGlobalConfigSchema });

export const saveGlobalConfig = (config: GlobalConfig): ResultAsync<void> =>
  repoSaveGlobalConfig(config);

export const loadWorkspaceConfig = async (
  root: string,
  globalConfig: GlobalConfig,
): ResultAsync<AppConfig> => {
  const result = await repoLoadWorkspaceConfig(root, {
    binderDir: BINDER_DIR,
    globalConfig,
    configSchema: cliWorkspaceConfigSchema,
  });
  if (isErr(result)) return result;

  const loaded = result.data;
  const { docsPath, include, exclude, validation, author, logLevel } = loaded;
  const mergedExclude = [...DEFAULT_EXCLUDE_PATTERNS, ...(exclude ?? [])];

  return ok({
    author,
    logLevel,
    paths: {
      root,
      binder: loaded.paths.binder,
      data: loaded.paths.data,
      backups: join(loaded.paths.data, BACKUPS_DIR),
      docs: join(root, docsPath),
    },
    include,
    exclude: mergedExclude,
    validation,
  });
};

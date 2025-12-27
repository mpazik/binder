import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { z } from "zod";
import * as YAML from "yaml";
import {
  createError,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import type { FileSystem } from "./lib/filesystem.ts";
import { LOG_LEVELS, type LogLevel } from "./log.ts";
import { isDevMode } from "./build-time.ts";

const DEFAULT_AUTHOR = "cli-user";
export const DEFAULT_DOCS_PATH = isDevMode() ? "docs-dev" : "docs";
export const CONFIG_FILE = "config.yaml";
export const BINDER_DIR = isDevMode() ? ".binder-dev" : ".binder";
export const DB_FILE = "binder.db";
export const TRANSACTION_LOG_FILE = "transactions.jsonl";
export const UNDO_LOG_FILE = "undo.jsonl";
export const LOCK_FILE = "lock";
export const LOCK_RETRY_DELAY_MS = 200;
export const LOCK_MAX_RETRIES = 3;

export const GlobalConfigSchema = z.object({
  author: z.string().optional(),
  logLevel: z.enum(LOG_LEVELS).optional(),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export const UserConfigSchema = GlobalConfigSchema.extend({
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
export type UserConfig = z.infer<typeof UserConfigSchema>;

const loadConfigFile = async <T extends z.ZodTypeAny>(
  path: string,
  schema: T,
): ResultAsync<z.infer<T>> => {
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(path);
    if (!(await bunFile.exists())) {
      return null;
    }
    const text = await bunFile.text();
    return YAML.parse(text);
  });

  if (isErr(fileResult)) return fileResult;

  const rawConfig = fileResult.data ?? {};

  return tryCatch(
    () => schema.parse(rawConfig),
    (error) =>
      createError("config-parse-failed", `Failed to parse config at ${path}`, {
        error,
      }),
  );
};

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
  docs: string;
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

const getGlobalConfigPath = (): string => {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "binder");
};

export const getGlobalStatePath = (): string => {
  const stateHome =
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
  return join(stateHome, "binder");
};

export const loadGlobalConfig = async (): ResultAsync<GlobalConfig> => {
  return loadConfigFile(
    join(getGlobalConfigPath(), CONFIG_FILE),
    GlobalConfigSchema,
  );
};

export const loadWorkspaceConfig = async (
  root: string,
  globalConfig: GlobalConfig,
): ResultAsync<AppConfig> => {
  const configPath = join(root, BINDER_DIR, CONFIG_FILE);
  const loadedConfig = await loadConfigFile(configPath, UserConfigSchema);

  if (isErr(loadedConfig)) return loadedConfig;

  const { docsPath, author, logLevel, include, exclude, validation } =
    loadedConfig.data;

  return ok({
    author: author || globalConfig.author || DEFAULT_AUTHOR,
    logLevel: logLevel || globalConfig.logLevel,
    paths: {
      root,
      binder: join(root, BINDER_DIR),
      docs: join(root, docsPath),
    },
    include,
    exclude,
    validation,
  });
};

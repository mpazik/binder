import { join } from "node:path";
import { z } from "zod";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import {
  CoreConfigSchema,
  findNearestAncestorWith,
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

/** LLM provider/model selector. Both fields optional so per-operation overrides can leave the default in place. */
const llmModelRefSchema = z
  .object({
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

/** LLM config block shared by global and workspace configs. */
export const llmConfigSchema = z
  .object({
    default: llmModelRefSchema.optional(),
    operations: z.record(z.string(), llmModelRefSchema).optional(),
  })
  .strict();

export type LlmModelRef = z.infer<typeof llmModelRefSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;

/** Complete schema for the CLI's global config file. Extends core. */
export const cliGlobalConfigSchema = CoreConfigSchema.extend({
  logLevel: z.enum(LOG_LEVELS).optional(),
  telemetry: z.boolean().nullable().optional(),
  llm: llmConfigSchema.optional(),
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
  llm: llmConfigSchema.optional(),
});

export type UserConfig = z.infer<typeof cliWorkspaceConfigSchema>;

/**
 * Walk up from `startPath` (or cwd) looking for a `<BINDER_DIR>` directory.
 * Returns `ok(null)` when no workspace is found — callers decide whether that
 * is an error. Uses the dir-only marker (not config.yaml) so a partially
 * initialized workspace still counts as "present" for `init`'s nesting check.
 */
export const findBinderRoot = async (
  startPath?: string,
): ResultAsync<string | null> => {
  const found = await findNearestAncestorWith(
    startPath ?? process.cwd(),
    BINDER_DIR,
  );
  return ok(found);
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
  llm?: LlmConfig;
};

/**
 * Merge global and workspace `llm` blocks. Workspace overrides global at the
 * field level: workspace.default.* wins over global.default.*, and per-operation
 * entries are merged so workspace-only operations are added and shared ones win field-by-field.
 */
export const mergeLlmConfig = (
  global: LlmConfig | undefined,
  workspace: LlmConfig | undefined,
): LlmConfig | undefined => {
  if (!global && !workspace) return undefined;
  const mergedDefault: LlmModelRef | undefined =
    global?.default || workspace?.default
      ? { ...(global?.default ?? {}), ...(workspace?.default ?? {}) }
      : undefined;
  const operationKeys = new Set<string>([
    ...Object.keys(global?.operations ?? {}),
    ...Object.keys(workspace?.operations ?? {}),
  ]);
  const operations: Record<string, LlmModelRef> = {};
  for (const key of operationKeys) {
    operations[key] = {
      ...(global?.operations?.[key] ?? {}),
      ...(workspace?.operations?.[key] ?? {}),
    };
  }
  const result: LlmConfig = {};
  if (mergedDefault) result.default = mergedDefault;
  if (operationKeys.size > 0) result.operations = operations;
  return result;
};

/**
 * Resolve the provider+model for a given operation. Per-operation entries
 * override `default` field-by-field. Returns null when neither yields
 * both fields.
 */
export const resolveLlmConfig = (
  llm: LlmConfig | undefined,
  operation: string,
): { provider: string; model: string } | null => {
  if (!llm) return null;
  const op = llm.operations?.[operation] ?? {};
  const def = llm.default ?? {};
  const provider = op.provider ?? def.provider;
  const model = op.model ?? def.model;
  if (!provider || !model) return null;
  return { provider, model };
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

  const loaded = result.data as typeof result.data & { llm?: LlmConfig };
  const { docsPath, include, exclude, validation, author, logLevel, llm } =
    loaded;
  const mergedExclude = [...DEFAULT_EXCLUDE_PATTERNS, ...(exclude ?? [])];
  const mergedLlm = mergeLlmConfig(globalConfig.llm, llm);

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
    llm: mergedLlm,
  });
};

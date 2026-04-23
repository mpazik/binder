import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import * as YAML from "yaml";
import {
  createError,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { BINDER_DIR, CONFIG_FILE, getDefaultAuthor } from "./constants.ts";
import {
  getGlobalConfigPath,
  resolveWorkspacePaths,
  type WorkspacePaths,
} from "./paths.ts";

/**
 * Core fields repo/local owns in config files. Clients that want additional
 * fields (e.g. logLevel, telemetry) compose their own schema by extending
 * this one, then pass it via the `configSchema` loader option.
 */
export const CoreConfigSchema = z.object({
  author: z.string().optional(),
});

export type CoreConfig = z.infer<typeof CoreConfigSchema>;

export type GlobalConfig<S extends z.ZodTypeAny = typeof CoreConfigSchema> =
  z.infer<S>;

export type WorkspaceConfig<S extends z.ZodTypeAny = typeof CoreConfigSchema> =
  z.infer<S> & { author: string; paths: WorkspacePaths };

const readConfigFile = async <S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): ResultAsync<z.infer<S>> => {
  const parseError = (error: unknown) =>
    createError("config-parse-failed", `Failed to parse config at ${path}`, {
      data: { error },
    });

  const fileExists = await access(path).then(
    () => true,
    () => false,
  );
  if (!fileExists)
    return tryCatch(() => schema.parse({}) as z.infer<S>, parseError);

  const fileResult = await tryCatch(async () => {
    const text = await readFile(path, "utf-8");
    return YAML.parse(text);
  });
  if (isErr(fileResult)) return fileResult;

  return tryCatch(
    () => schema.parse(fileResult.data ?? {}) as z.infer<S>,
    parseError,
  );
};

export type LoadGlobalConfigOptions<
  S extends z.ZodTypeAny = typeof CoreConfigSchema,
> = {
  /**
   * Schema describing the config file contents. Must extend
   * `CoreConfigSchema` so the `author` field is parsed. Defaults to
   * `CoreConfigSchema`.
   */
  configSchema?: S;
  /** Absolute path override. Defaults to `$XDG_CONFIG_HOME/binder/config.yaml`. */
  path?: string;
};

/**
 * Load the global config from `$XDG_CONFIG_HOME/binder/config.yaml`.
 * Missing file is not an error — returns parsed defaults from the schema.
 */
export const loadGlobalConfig = async <
  S extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  options?: LoadGlobalConfigOptions<S>,
): ResultAsync<z.infer<S>> => {
  const schema = (options?.configSchema ?? CoreConfigSchema) as S;
  const path = options?.path ?? join(getGlobalConfigPath(), CONFIG_FILE);
  return readConfigFile<S>(path, schema);
};

/** Persist the global config. Creates the parent directory if missing. */
export const saveGlobalConfig = async (
  config: Record<string, unknown>,
  options?: { path?: string },
): ResultAsync<void> => {
  return tryCatch(async () => {
    const filePath = options?.path ?? join(getGlobalConfigPath(), CONFIG_FILE);
    const dir = join(filePath, "..");
    await mkdir(dir, { recursive: true });

    const content = YAML.stringify(config, {
      indent: 2,
      lineWidth: 0,
      defaultStringType: "PLAIN",
    });
    await writeFile(filePath, content, "utf-8");
  });
};

export type LoadWorkspaceConfigOptions<
  S extends z.ZodTypeAny = typeof CoreConfigSchema,
> = {
  /** Override for the `.binder` directory name (e.g., `.binder-dev`). */
  binderDir?: string;
  /**
   * Pre-loaded global config to use as fallback. Only `author` is read.
   * Loaded internally if omitted.
   */
  globalConfig?: { author?: string };
  /**
   * Schema describing the workspace config file. Must extend
   * `CoreConfigSchema`. Defaults to `CoreConfigSchema`.
   */
  configSchema?: S;
  /**
   * Last-resort author when no config and no global config supply one.
   * Defaults to `getDefaultAuthor()` (OS username, git-style).
   */
  defaultAuthor?: string;
};

/**
 * Load the workspace config from `<root>/<binderDir>/config.yaml`,
 * falling back to the global config for `author`.
 *
 * Author resolution order:
 *   workspace config → global config → `defaultAuthor` → `getDefaultAuthor()`.
 */
export const loadWorkspaceConfig = async <
  S extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  root: string,
  options?: LoadWorkspaceConfigOptions<S>,
): ResultAsync<WorkspaceConfig<S>> => {
  const binderDir = options?.binderDir ?? BINDER_DIR;
  const paths = resolveWorkspacePaths(root, binderDir);
  const configPath = join(paths.binder, CONFIG_FILE);
  const schema = (options?.configSchema ?? CoreConfigSchema) as S;

  const workspaceResult = await readConfigFile<S>(configPath, schema);
  if (isErr(workspaceResult)) return workspaceResult;

  let global = options?.globalConfig;
  if (!global) {
    const globalResult = await loadGlobalConfig();
    if (isErr(globalResult)) return globalResult;
    global = globalResult.data as { author?: string };
  }

  const parsed = workspaceResult.data as z.infer<S> & { author?: string };
  const author =
    parsed.author ??
    global.author ??
    options?.defaultAuthor ??
    getDefaultAuthor();

  return ok({
    ...parsed,
    author,
    paths,
  } as WorkspaceConfig<S>);
};

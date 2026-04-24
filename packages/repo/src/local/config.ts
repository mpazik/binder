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

export const PluginSpecSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional().default(true),
  }),
]);
export type PluginSpec = z.infer<typeof PluginSpecSchema>;

export const HookSpecSchema = z.object({
  name: z.string(),
  command: z.string(),
});
export type HookSpec = z.infer<typeof HookSpecSchema>;

export const CoreConfigSchema = z.object({
  author: z.string().optional(),
  plugins: z.array(PluginSpecSchema).optional(),
  hooks: z.array(HookSpecSchema).optional(),
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
  configSchema?: S;
  path?: string;
};

export const loadGlobalConfig = async <
  S extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  options?: LoadGlobalConfigOptions<S>,
): ResultAsync<z.infer<S>> => {
  const schema = (options?.configSchema ?? CoreConfigSchema) as S;
  const path = options?.path ?? join(getGlobalConfigPath(), CONFIG_FILE);
  return readConfigFile<S>(path, schema);
};

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
  binderDir?: string;
  globalConfig?: { author?: string };
  configSchema?: S;
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

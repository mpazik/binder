import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as YAML from "yaml";
import {
  assertDefined,
  createError,
  fail,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import type { z } from "zod";
import type { ConfigDataType, EntitySchema, RecordSchema } from "../model";
import { type DrizzleDb, type OpenDbMigrationOptions, openDb } from "../db.ts";
import {
  type KnowledgeGraph,
  type KnowledgeGraphCallbacks,
  type ReadonlyKnowledgeGraph,
  openKnowledgeGraph,
} from "../knowledge-graph.ts";
import type * as coreSchema from "../schema.ts";
import type { BinderRepoPlugin } from "./plugin.ts";
import { BINDER_DIR, CONFIG_FILE, DB_FILE } from "./constants.ts";
import {
  type CoreConfig,
  type CoreConfigSchema,
  type LoadWorkspaceConfigOptions,
  loadWorkspaceConfig,
  type WorkspaceConfig,
} from "./config.ts";
import { resolveWorkspacePaths } from "./paths.ts";
import { hooksToPlugin, loadPluginsFromConfig } from "./plugin-loader.ts";

type DbSchema = Record<string, unknown>;

export type OpenCallbacksFactory<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = (kg: KnowledgeGraph<C>) => KnowledgeGraphCallbacks;

export type OpenOptions<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = {
  plugins?: BinderRepoPlugin[];
  binderDir?: string;
  config?: WorkspaceConfig<CS>;
  defaultAuthor?: string;
  dbSchema?: TSchema;
  migrate?: boolean | OpenDbMigrationOptions<TSchema>;
  configSchema?: CS;
  providerSchema?: RecordSchema;
  kgConfigSchema?: C;
  // Transitional — will be superseded by the plugin system.
  callbacks?: KnowledgeGraphCallbacks | OpenCallbacksFactory<C>;
  configLoadOptions?: LoadWorkspaceConfigOptions<CS>;
};

export type Repo<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = KnowledgeGraph<C> & {
  readonly config: WorkspaceConfig<CS>;
  readonly db: DrizzleDb<TSchema>;
  readonly plugins: BinderRepoPlugin[];
  close: () => Promise<void>;
};

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Walks up from `startPath` looking for a directory containing `marker`.
 * Returns the first matching ancestor (or `startPath` itself), or `null` if
 * none is found before reaching the filesystem root.
 */
export const findNearestAncestorWith = async (
  startPath: string,
  marker: string,
): Promise<string | null> => {
  let current = resolve(startPath);
  const root = resolve("/");
  while (true) {
    if (await exists(join(current, marker))) return current;
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

export type ResolveWorkspaceRootOptions = {
  /**
   * Path (relative to each candidate root) that must exist for it to count
   * as a workspace. Defaults to `<BINDER_DIR>/<CONFIG_FILE>`.
   */
  marker?: string;
};

/**
 * Resolves the workspace root directory using a three-step fallback:
 *   1. Explicit `start` path (returned as-is; caller validates)
 *   2. `BINDER_WORKSPACE` environment variable (returned as-is)
 *   3. Walk up from `process.cwd()` looking for the `marker`
 *
 * Fails with `workspace-not-found` only when the walk-up finds nothing.
 */
export const resolveWorkspaceRoot = async (
  start?: string,
  options?: ResolveWorkspaceRootOptions,
): ResultAsync<string> => {
  if (start !== undefined) return ok(resolve(start));

  const fromEnv = process.env.BINDER_WORKSPACE;
  if (fromEnv) return ok(resolve(fromEnv));

  const marker = options?.marker ?? join(BINDER_DIR, CONFIG_FILE);
  const found = await findNearestAncestorWith(process.cwd(), marker);
  if (found !== null) return ok(found);

  return fail(
    "workspace-not-found",
    `No Binder workspace found by walking up from ${process.cwd()} (looking for ${marker})`,
    { data: { cwd: process.cwd(), marker } },
  );
};

const resolveCallbacks = <C extends EntitySchema<ConfigDataType>>(
  input: KnowledgeGraphCallbacks | OpenCallbacksFactory<C> | undefined,
  kgRef: { kg: KnowledgeGraph<C> | null },
): KnowledgeGraphCallbacks | undefined => {
  if (!input) return undefined;
  if (typeof input !== "function") return input;

  let cached: KnowledgeGraphCallbacks | null = null;
  const factory = input as OpenCallbacksFactory<C>;
  const getCallbacks = (): KnowledgeGraphCallbacks => {
    if (cached) return cached;
    assertDefined(
      kgRef.kg,
      "knowledge graph (must be set before callbacks fire)",
    );
    cached = factory(kgRef.kg);
    return cached;
  };

  return {
    beforeTransaction: async (tx) => {
      const cb = getCallbacks().beforeTransaction;
      if (!cb) return ok(async () => ok(undefined));
      return cb(tx);
    },
    beforeCommit: async (tx) => {
      const cb = getCallbacks().beforeCommit;
      if (!cb) return ok(undefined);
      return cb(tx);
    },
    afterCommit: async (tx) => {
      const cb = getCallbacks().afterCommit;
      if (cb) await cb(tx);
    },
    afterRollback: async (txs, count) => {
      const cb = getCallbacks().afterRollback;
      if (cb) await cb(txs, count);
    },
  };
};

type ResolvedWorkspace<CS extends z.ZodTypeAny> = {
  root: string;
  paths: ReturnType<typeof resolveWorkspacePaths>;
  config: WorkspaceConfig<CS>;
};

/** Resolves root, validates workspace exists, and loads config. Shared by open/openReadonly. */
const resolveWorkspace = async <CS extends z.ZodTypeAny>(
  workspaceRoot: string | undefined,
  options?: {
    binderDir?: string;
    config?: WorkspaceConfig<CS>;
    defaultAuthor?: string;
    configSchema?: CS;
    configLoadOptions?: LoadWorkspaceConfigOptions<CS>;
  },
): ResultAsync<ResolvedWorkspace<CS>> => {
  let resolvedRoot: string;
  if (workspaceRoot !== undefined) {
    resolvedRoot = workspaceRoot;
  } else {
    const rootResult = await resolveWorkspaceRoot();
    if (isErr(rootResult)) return rootResult;
    resolvedRoot = rootResult.data;
  }
  const binderDir = options?.binderDir ?? BINDER_DIR;
  const paths = resolveWorkspacePaths(resolvedRoot, binderDir);

  const configPath = join(paths.binder, CONFIG_FILE);
  if (!(await exists(configPath))) {
    return fail(
      "workspace-not-found",
      `No Binder workspace at ${resolvedRoot} (missing ${configPath})`,
      { data: { workspaceRoot: resolvedRoot, configPath } },
    );
  }

  let config: WorkspaceConfig<CS>;
  if (options?.config) {
    config = options.config;
  } else {
    const configResult = await loadWorkspaceConfig<CS>(resolvedRoot, {
      binderDir,
      defaultAuthor: options?.defaultAuthor,
      configSchema: options?.configSchema,
      ...(options?.configLoadOptions ?? {}),
    });
    if (isErr(configResult)) return configResult;
    config = configResult.data;
  }

  return ok({ root: resolvedRoot, paths, config });
};

/**
 * Opens a binder workspace for read-write access. When `workspaceRoot` is
 * omitted the root is resolved via {@link resolveWorkspaceRoot}.
 * Fails with `workspace-not-found` if config.yaml does not exist.
 */
export const open = async <
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  workspaceRoot?: string,
  options?: OpenOptions<TSchema, C, CS>,
): ResultAsync<Repo<TSchema, C, CS>> => {
  const wsResult = await resolveWorkspace<CS>(workspaceRoot, options);
  if (isErr(wsResult)) return wsResult;
  const { paths, config } = wsResult.data;

  const dbPath = join(paths.data, DB_FILE);
  const dbResult = openDb<TSchema>({
    path: dbPath,
    schema: options?.dbSchema,
    migrate: options?.migrate ?? true,
  });
  if (isErr(dbResult)) return dbResult;
  const db = dbResult.data;

  const kgRef: { kg: KnowledgeGraph<C> | null } = { kg: null };
  const userCallbacks = resolveCallbacks<C>(options?.callbacks, kgRef);

  const kg = openKnowledgeGraph<C>(
    db as unknown as DrizzleDb<typeof coreSchema>,
    {
      providerSchema: options?.providerSchema,
      configSchema: options?.kgConfigSchema,
      callbacks: userCallbacks,
    },
  );
  kgRef.kg = kg;

  const loadedPlugins: BinderRepoPlugin[] = [];

  const repo: Repo<TSchema, C, CS> = Object.assign(kg, {
    config,
    db,
    plugins: loadedPlugins,
    close: async () => {
      // Dispose in reverse registration order.
      for (let i = loadedPlugins.length - 1; i >= 0; i--) {
        await tryCatch(async () => {
          await loadedPlugins[i]!.dispose?.();
        });
        // TODO: log disposal errors.
      }
      tryCatch(() => db.$client.close());
    },
  });

  const configAny = config as unknown as { plugins?: any[]; hooks?: any[] };
  const fromConfig = await loadPluginsFromConfig(configAny.plugins);
  const programmatic = (options?.plugins ?? []).map((p) => ({
    plugin: p,
    pluginConfig: undefined,
  }));
  const hookPlugin = configAny.hooks?.length
    ? [{ plugin: hooksToPlugin(configAny.hooks), pluginConfig: undefined }]
    : [];

  for (const { plugin, pluginConfig } of [
    ...programmatic,
    ...fromConfig,
    ...hookPlugin,
  ]) {
    loadedPlugins.push(plugin);
    await plugin.register?.({ repo, pluginConfig });
  }

  return ok(repo);
};

export type ReadonlyRepo<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = ReadonlyKnowledgeGraph<C> & {
  readonly config: WorkspaceConfig<CS>;
  readonly db: DrizzleDb<TSchema>;
  close: () => void;
};

export type OpenReadonlyOptions<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = Pick<
  OpenOptions<TSchema, C, CS>,
  | "binderDir"
  | "config"
  | "defaultAuthor"
  | "dbSchema"
  | "configSchema"
  | "providerSchema"
  | "kgConfigSchema"
  | "configLoadOptions"
>;

/**
 * Opens a binder workspace in readonly mode (no plugins, no migrations).
 * When `workspaceRoot` is omitted the root is resolved via
 * {@link resolveWorkspaceRoot}. Fails on write attempts.
 */
export const openReadonly = async <
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  workspaceRoot?: string,
  options?: OpenReadonlyOptions<TSchema, C, CS>,
): ResultAsync<ReadonlyRepo<TSchema, C, CS>> => {
  const wsResult = await resolveWorkspace<CS>(workspaceRoot, options);
  if (isErr(wsResult)) return wsResult;
  const { paths, config } = wsResult.data;

  const dbPath = join(paths.data, DB_FILE);
  const dbResult = openDb<TSchema>({
    path: dbPath,
    schema: options?.dbSchema,
    migrate: false,
    readonly: true,
  });
  if (isErr(dbResult)) return dbResult;
  const db = dbResult.data;

  const kg = openKnowledgeGraph<C>(
    db as unknown as DrizzleDb<typeof coreSchema>,
    {
      providerSchema: options?.providerSchema,
      configSchema: options?.kgConfigSchema,
    },
  );

  const repo: ReadonlyRepo<TSchema, C, CS> = Object.assign(kg, {
    config,
    db,
    close: () => {
      tryCatch(() => db.$client.close());
    },
  }) as ReadonlyRepo<TSchema, C, CS>;

  return ok(repo);
};

export type InitOptions<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = OpenOptions<TSchema, C, CS> & {
  initialConfig?: Partial<CoreConfig> & Record<string, unknown>;
  overwrite?: boolean;
};

export const init = async <
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  workspaceRoot: string,
  options?: InitOptions<TSchema, C, CS>,
): ResultAsync<Repo<TSchema, C, CS>> => {
  const binderDir = options?.binderDir ?? BINDER_DIR;
  const paths = resolveWorkspacePaths(workspaceRoot, binderDir);
  if ((await exists(paths.binder)) && !options?.overwrite) {
    return fail(
      "workspace-exists",
      `Binder workspace already exists at ${paths.binder}`,
      { data: { workspaceRoot, binderDir: paths.binder } },
    );
  }

  const mkdirResult = await tryCatch(
    async () => {
      await mkdir(paths.data, { recursive: true });
    },
    (error) =>
      createError(
        "workspace-init-failed",
        `Failed to create workspace directories at ${paths.binder}`,
        { data: error instanceof Error ? { stack: error.stack } : undefined },
      ),
  );
  if (isErr(mkdirResult)) return mkdirResult;

  const configYaml = Object.fromEntries(
    Object.entries(options?.initialConfig ?? {}).filter(
      ([, v]) => v !== undefined,
    ),
  );

  const writeResult = await tryCatch(
    async () => {
      const content = YAML.stringify(configYaml, {
        indent: 2,
        lineWidth: 0,
        defaultStringType: "PLAIN",
      });
      await writeFile(join(paths.binder, CONFIG_FILE), content, "utf-8");
    },
    (error) =>
      createError(
        "workspace-init-failed",
        `Failed to write config.yaml in ${paths.binder}`,
        { data: error instanceof Error ? { stack: error.stack } : undefined },
      ),
  );
  if (isErr(writeResult)) return writeResult;

  return open<TSchema, C, CS>(workspaceRoot, options);
};

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as YAML from "yaml";
import {
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
import { BINDER_DIR, CONFIG_FILE, DB_FILE } from "./constants.ts";
import {
  type CoreConfig,
  type CoreConfigSchema,
  type LoadWorkspaceConfigOptions,
  loadWorkspaceConfig,
  type WorkspaceConfig,
} from "./config.ts";
import { resolveWorkspacePaths } from "./paths.ts";

type DbSchema = Record<string, unknown>;

export type OpenCallbacksFactory<
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
> = (kg: KnowledgeGraph<C>) => KnowledgeGraphCallbacks;

export type OpenOptions<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = {
  /** Override for `.binder` directory name. Default `BINDER_DIR`. */
  binderDir?: string;
  /** Pre-loaded workspace config. If omitted, `open()` loads it. */
  config?: WorkspaceConfig<CS>;
  /** Last-resort author for config loading. */
  defaultAuthor?: string;

  /** Optional Drizzle DB schema extension. */
  dbSchema?: TSchema;
  /** Migration behavior. `true` runs core migrations. Object enables custom runner. */
  migrate?: boolean | OpenDbMigrationOptions<TSchema>;

  /**
   * Schema for the workspace `config.yaml` file. Must extend
   * `CoreConfigSchema`. Defaults to `CoreConfigSchema`.
   */
  configSchema?: CS;

  /** Optional record-provider schema for knowledge graph. */
  providerSchema?: RecordSchema;
  /** Optional schema for KG config entities (Types, Fields, Views, ...). */
  kgConfigSchema?: C;

  /**
   * Knowledge-graph callbacks. Either a plain callbacks object, or a factory
   * that receives the constructed `KnowledgeGraph` and returns callbacks —
   * useful when callbacks need to close over the graph itself.
   *
   * Transitional API. Will be superseded by the plugin system.
   */
  callbacks?: KnowledgeGraphCallbacks | OpenCallbacksFactory<C>;

  /**
   * Options forwarded to `loadWorkspaceConfig` when `config` is omitted.
   * Rarely needed — the defaults match typical usage.
   */
  configLoadOptions?: LoadWorkspaceConfigOptions<CS>;
};

export type Repo<
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
> = KnowledgeGraph<C> & {
  readonly config: WorkspaceConfig<CS>;
  readonly db: DrizzleDb<TSchema>;
  close: () => void;
};

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

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
    if (!kgRef.kg) {
      // invariant: set synchronously after openKnowledgeGraph returns
      // eslint-disable-next-line no-restricted-syntax
      throw new Error(
        "callback factory invoked before knowledge graph construction completed",
      );
    }
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

/**
 * Open an initialized Binder workspace as a library.
 *
 * Fails with `workspace-not-found` if `<workspaceRoot>/<binderDir>/config.yaml`
 * does not exist. Use {@link init} to create a new workspace.
 */
export const open = async <
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  workspaceRoot: string,
  options?: OpenOptions<TSchema, C, CS>,
): ResultAsync<Repo<TSchema, C, CS>> => {
  const binderDir = options?.binderDir ?? BINDER_DIR;
  const paths = resolveWorkspacePaths(workspaceRoot, binderDir);

  const configPath = join(paths.binder, CONFIG_FILE);
  if (!(await exists(configPath))) {
    return fail(
      "workspace-not-found",
      `No Binder workspace at ${workspaceRoot} (missing ${configPath})`,
      { data: { workspaceRoot, configPath } },
    );
  }

  let config: WorkspaceConfig<CS>;
  if (options?.config) {
    config = options.config;
  } else {
    const configResult = await loadWorkspaceConfig<CS>(workspaceRoot, {
      binderDir,
      defaultAuthor: options?.defaultAuthor,
      configSchema: options?.configSchema,
      ...(options?.configLoadOptions ?? {}),
    });
    if (isErr(configResult)) return configResult;
    config = configResult.data;
  }

  const dbPath = join(paths.data, DB_FILE);
  const dbResult = openDb<TSchema>({
    path: dbPath,
    schema: options?.dbSchema,
    migrate: options?.migrate ?? true,
  });
  if (isErr(dbResult)) return dbResult;
  const db = dbResult.data;

  const kgRef: { kg: KnowledgeGraph<C> | null } = { kg: null };
  const callbacks = resolveCallbacks<C>(options?.callbacks, kgRef);

  const kg = openKnowledgeGraph<C>(
    db as unknown as DrizzleDb<typeof coreSchema>,
    {
      providerSchema: options?.providerSchema,
      configSchema: options?.kgConfigSchema,
      callbacks,
    },
  );
  kgRef.kg = kg;

  const repo: Repo<TSchema, C, CS> = Object.assign(kg, {
    config,
    db,
    close: () => {
      tryCatch(() => db.$client.close());
    },
  });

  return ok(repo);
};

/**
 * Read-only view of a repo: mutation methods and plugin/subscription surface
 * removed. Returned by {@link openReadonly}.
 */
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
 * Open an initialized Binder workspace read-only.
 *
 * Skips plugin loading, skips migrations, opens SQLite in readonly mode.
 * Use this for cheap reads (CLI queries, LSP read handlers, analysis
 * scripts) that never mutate state.
 *
 * Fails with `workspace-not-found` if the workspace does not exist.
 * Fails on write attempts at the SQLite driver level.
 */
export const openReadonly = async <
  TSchema extends DbSchema = typeof coreSchema,
  C extends EntitySchema<ConfigDataType> = EntitySchema<ConfigDataType>,
  CS extends z.ZodTypeAny = typeof CoreConfigSchema,
>(
  workspaceRoot: string,
  options?: OpenReadonlyOptions<TSchema, C, CS>,
): ResultAsync<ReadonlyRepo<TSchema, C, CS>> => {
  const binderDir = options?.binderDir ?? BINDER_DIR;
  const paths = resolveWorkspacePaths(workspaceRoot, binderDir);

  const configPath = join(paths.binder, CONFIG_FILE);
  if (!(await exists(configPath))) {
    return fail(
      "workspace-not-found",
      `No Binder workspace at ${workspaceRoot} (missing ${configPath})`,
      { data: { workspaceRoot, configPath } },
    );
  }

  let config: WorkspaceConfig<CS>;
  if (options?.config) {
    config = options.config;
  } else {
    const configResult = await loadWorkspaceConfig<CS>(workspaceRoot, {
      binderDir,
      defaultAuthor: options?.defaultAuthor,
      configSchema: options?.configSchema,
      ...(options?.configLoadOptions ?? {}),
    });
    if (isErr(configResult)) return configResult;
    config = configResult.data;
  }

  const dbPath = join(paths.data, DB_FILE);
  const dbResult = openDb<TSchema>({
    path: dbPath,
    schema: options?.dbSchema,
    migrate: false,
    readonly: true,
  });
  if (isErr(dbResult)) return dbResult;
  const db = dbResult.data;

  // No callbacks, no plugins, no subscriptions. Purely read.
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
  /** Fields written to `config.yaml` on creation. */
  initialConfig?: Partial<CoreConfig> & Record<string, unknown>;
  /** Allow initializing on top of an existing `.binder/`. Default false. */
  overwrite?: boolean;
};

/**
 * Initialize a new Binder workspace and open it.
 *
 * Creates `<workspaceRoot>/<binderDir>/config.yaml` and `data/` directory.
 * Fails with `workspace-exists` if `<binderDir>` already exists and
 * `overwrite !== true`.
 */
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

import { mkdirSync } from "fs";
import { join } from "path";
import * as YAML from "yaml";
import {
  errorToObject,
  isErr,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import {
  type Database,
  type KnowledgeGraph,
  openDb,
  openKnowledgeGraph,
} from "@binder/db";
import {
  BINDER_DIR,
  type BinderConfig,
  BinderConfigSchema,
  CONFIG_FILE,
  DB_FILE,
  findBinderRoot,
} from "./config.ts";
import * as ui from "./ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { setupCleanupHandlers, withLock } from "./lib/lock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import { Log, type Logger } from "./log.ts";

export type Config = Omit<BinderConfig, "docsPath"> & {
  paths: {
    root: string;
    binder: string;
    docs: string;
  };
};

const loadConfig = async (root: string): ResultAsync<Config> => {
  const configPath = join(root, BINDER_DIR, CONFIG_FILE);
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(configPath);
    if (!(await bunFile.exists())) {
      return null;
    }
    const text = await bunFile.text();
    return YAML.parse(text);
  }, errorToObject);

  if (isErr(fileResult)) return fileResult;

  const rawConfig = fileResult.data ?? {};

  const loadedConfig = tryCatch(
    () => BinderConfigSchema.parse(rawConfig),
    errorToObject,
  );
  if (isErr(loadedConfig)) return loadedConfig;

  const { docsPath, ...rest } = loadedConfig.data;
  return ok({
    ...rest,
    paths: {
      root,
      binder: join(root, BINDER_DIR),
      docs: join(root, docsPath),
    },
  });
};

export type CommandContext = {
  config: Config;
  log: Logger;
  ui: typeof ui;
  fs: FileSystem;
};

export type KnowledgeGraphReadonly = Omit<
  KnowledgeGraph,
  "update" | "apply" | "rollback"
>;
export type CommandContextWithDbRead = CommandContext & {
  kg: KnowledgeGraphReadonly;
};
export type CommandContextWithDbWrite = CommandContext & {
  db: Database;
  kg: KnowledgeGraph;
};

export type CommandHandler<TArgs = unknown> = (
  context: CommandContext & { args: TArgs },
) => Promise<Result<string | undefined>>;

export type CommandHandlerWithDbWrite<TArgs = unknown> = (
  context: CommandContextWithDbWrite & { args: TArgs },
) => Promise<Result<string | undefined>>;

export type CommandHandlerWithDbRead<TArgs = unknown> = (
  context: CommandContextWithDbRead & { args: TArgs },
) => Promise<Result<string | undefined>>;

export const bootstrap = <TArgs>(
  handler: CommandHandler<TArgs>,
): ((args: TArgs) => Promise<void>) => {
  return async (args: TArgs) => {
    const fs = createRealFileSystem();
    const rootResult = findBinderRoot(fs);
    if (isErr(rootResult)) {
      ui.error(`Failed to load binder workspace: ${rootResult.error.message}`);
      process.exit(1);
    }

    if (rootResult.data === null) {
      ui.error(
        `Not in a binder workspace. Use 'binder init' to initialize a new workspace.`,
      );
      process.exit(1);
    }

    const configResult = await loadConfig(rootResult.data);
    if (isErr(configResult)) {
      ui.error(`Failed to load config: ${configResult.error.message}`);
      process.exit(1);
    }

    const result = await handler({
      config: configResult.data,
      log: Log,
      ui,
      args,
      fs,
    });

    if (isErr(result)) {
      ui.printError(result.error);
      process.exit(1);
    }

    if (result.data) {
      ui.println(ui.Style.TEXT_SUCCESS + result.data + ui.Style.TEXT_NORMAL);
    }
  };
};

export const bootstrapWithDbRead = <TArgs>(
  handler: CommandHandlerWithDbRead<TArgs>,
): ((args: TArgs) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config } = context;
    const binderPath = config.paths.binder;
    mkdirSync(binderPath, { recursive: true });
    setupCleanupHandlers(fs, binderPath);

    const dbResult = openDb({ path: join(binderPath, DB_FILE), migrate: true });
    if (isErr(dbResult)) {
      Log.error("Failed to open database", { error: dbResult.error });
      process.exit(1);
    }

    return handler({
      ...context,
      kg: openKnowledgeGraph(dbResult.data),
    });
  });
};

export const bootstrapWithDbWrite = <TArgs>(
  handler: CommandHandlerWithDbWrite<TArgs>,
): ((args: TArgs) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config } = context;
    const { paths } = config;
    mkdirSync(paths.binder, { recursive: true });
    setupCleanupHandlers(fs, paths.binder);

    const dbPath = join(paths.binder, DB_FILE);
    const dbResult = openDb({ path: dbPath, migrate: true });
    if (isErr(dbResult)) {
      Log.error("Failed to open database", { error: dbResult.error });
      process.exit(1);
    }

    const db = dbResult.data;
    const kg = openKnowledgeGraph(db);

    return withLock(fs, paths.binder, async () =>
      handler({
        ...context,
        db,
        kg,
      }),
    );
  });
};

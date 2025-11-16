import { mkdirSync } from "fs";
import { join } from "path";
import * as YAML from "yaml";
import { isErr, ok, type ResultAsync, tryCatch } from "@binder/utils";
import { type KnowledgeGraph, openKnowledgeGraph } from "@binder/db";
import { openCliDb, type DatabaseCli } from "./db";
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
import { createLogger, type Logger } from "./log.ts";
import { isDevMode } from "./build-time.ts";

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
  });

  if (isErr(fileResult)) return fileResult;

  const rawConfig = fileResult.data ?? {};

  const loadedConfig = tryCatch(() => BinderConfigSchema.parse(rawConfig));
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

export type GlobalOptions = {
  printLogs?: boolean;
  logLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR";
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
  db: DatabaseCli;
  kg: KnowledgeGraph;
};

export type CommandHandler<TArgs = object> = (
  context: CommandContext & { args: TArgs & GlobalOptions },
) => ResultAsync<string | undefined>;

export type CommandHandlerWithDbWrite<TArgs = object> = (
  context: CommandContextWithDbWrite & { args: TArgs & GlobalOptions },
) => ResultAsync<string | undefined>;

export type CommandHandlerWithDbRead<TArgs = object> = (
  context: CommandContextWithDbRead & { args: TArgs & GlobalOptions },
) => ResultAsync<string | undefined>;

export const bootstrap = <TArgs extends object = object>(
  handler: CommandHandler<TArgs>,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return async (args: TArgs & GlobalOptions) => {
    const fs = createRealFileSystem();
    const rootResult = await findBinderRoot(fs);
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

    const log = await createLogger({
      rootDir: configResult.data.paths.binder,
      printLogs: isDevMode() ? true : (args.printLogs ?? false),
      level: args.logLevel ?? (isDevMode() ? "DEBUG" : "INFO"),
    });

    let result;
    // eslint-disable-next-line no-restricted-syntax
    try {
      result = await handler({
        config: configResult.data,
        log,
        ui,
        args,
        fs,
      });
    } catch (e) {
      log.error("Command failed with exception", { error: e });
      ui.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    if (isErr(result)) {
      log.error("Command failed", { error: result.error });
      ui.printError(result.error);
      process.exit(1);
    }

    if (result.data) {
      ui.println(ui.Style.TEXT_SUCCESS + result.data + ui.Style.TEXT_NORMAL);
    }
  };
};

export const bootstrapWithDbRead = <TArgs extends object = object>(
  handler: CommandHandlerWithDbRead<TArgs>,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config, log } = context;
    const binderPath = config.paths.binder;
    mkdirSync(binderPath, { recursive: true });
    setupCleanupHandlers(fs, binderPath);

    const dbResult = openCliDb({
      path: join(binderPath, DB_FILE),
      migrate: true,
    });
    if (isErr(dbResult)) {
      log.error("Failed to open database", { error: dbResult.error });
      ui.printError(dbResult.error);
      process.exit(1);
    }

    return handler({
      ...context,
      kg: openKnowledgeGraph(dbResult.data),
    });
  });
};

export const openDbWrite = <T = void>(
  fs: FileSystem,
  log: Logger,
  config: Config,
  handler: (kg: KnowledgeGraph, db: DatabaseCli) => ResultAsync<T>,
): ResultAsync<T> => {
  const { paths } = config;
  const dbPath = join(paths.binder, DB_FILE);
  const dbResult = openCliDb({ path: dbPath, migrate: true });
  if (isErr(dbResult)) {
    log.error("Failed to open database", { error: dbResult.error });
    ui.printError(dbResult.error);
    process.exit(1);
  }

  const db = dbResult.data;
  const kg = setupKnowledgeGraph({ fs, log, config, db });

  return withLock(fs, paths.binder, async () => handler(kg, db));
};

export const bootstrapWithDbWrite = <TArgs extends object = object>(
  handler: CommandHandlerWithDbWrite<TArgs>,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config, log } = context;
    const { paths } = config;
    mkdirSync(paths.binder, { recursive: true });
    setupCleanupHandlers(fs, paths.binder);

    return openDbWrite(fs, log, config, (kg, db) =>
      handler({
        ...context,
        db,
        kg,
      }),
    );
  });
};

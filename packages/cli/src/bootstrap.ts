import { mkdirSync } from "fs";
import { join } from "path";
import * as YAML from "yaml";
import { isErr, ok, type ResultAsync, tryCatch } from "@binder/utils";
import { type KnowledgeGraph, openKnowledgeGraph } from "@binder/db";
import { type DatabaseCli, openCliDb } from "./db";
import {
  BINDER_DIR,
  UserConfigSchema,
  CONFIG_FILE,
  DB_FILE,
  findBinderRoot,
  type AppConfig,
} from "./config.ts";
import * as ui from "./ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { setupCleanupHandlers } from "./lib/lock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import { createLogger, type Logger } from "./log.ts";
import { isDevMode } from "./build-time.ts";

const loadConfig = async (root: string): ResultAsync<AppConfig> => {
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

  const loadedConfig = tryCatch(() => UserConfigSchema.parse(rawConfig));
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
  config: AppConfig;
  log: Logger;
  ui: typeof ui;
  fs: FileSystem;
};

export type CommandContextWithDb = CommandContext & {
  db: DatabaseCli;
  kg: KnowledgeGraph;
};

export type CommandHandler<TArgs = object> = (
  context: CommandContext & { args: TArgs & GlobalOptions },
) => ResultAsync<string | undefined>;

export type CommandHandlerWithDb<TArgs = object> = (
  context: CommandContextWithDb & { args: TArgs & GlobalOptions },
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

export const openDb = <T = void>(
  fs: FileSystem,
  log: Logger,
  config: AppConfig,
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

  return handler(kg, db);
};

export const bootstrapWithDb = <TArgs extends object = object>(
  handler: CommandHandlerWithDb<TArgs>,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config, log } = context;
    const { paths } = config;
    mkdirSync(paths.binder, { recursive: true });
    setupCleanupHandlers(fs, paths.binder);

    return openDb(fs, log, config, (kg, db) =>
      handler({
        ...context,
        db,
        kg,
      }),
    );
  });
};

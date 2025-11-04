import { mkdirSync } from "fs";
import { join } from "path";
import * as YAML from "yaml";
import {
  errorToObject,
  isErr,
  ok,
  okVoid,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import {
  type Database,
  type KnowledgeGraph,
  openDb,
  openKnowledgeGraph,
  type Transaction,
} from "@binder/db";
import { Log } from "./log.ts";
import {
  BINDER_DIR,
  type BinderConfig,
  BinderConfigSchema,
  CONFIG_FILE,
  DB_FILE,
  findBinderRoot,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
} from "./config.ts";
import * as ui from "./ui.ts";
import { clearTransactionLog, logTransaction } from "./transaction-log.ts";
import { renderDocs } from "./document/repository.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";

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
  log: typeof Log;
  ui: typeof ui;
  fs: FileSystem;
};

export type CommandContextWithDb = CommandContext & {
  db: Database;
  kg: KnowledgeGraph;
};

export type CommandHandler<TArgs = unknown> = (
  context: CommandContext & { args: TArgs },
) => Promise<Result<string | undefined>>;

export type CommandHandlerWithDb<TArgs = unknown> = (
  context: CommandContextWithDb & { args: TArgs },
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

export const bootstrapWithDb = <TArgs>(
  handler: CommandHandlerWithDb<TArgs>,
): ((args: TArgs) => Promise<void>) => {
  return bootstrap<TArgs>(async (context) => {
    const { fs, config } = context;
    const { paths } = config;
    mkdirSync(paths.binder, { recursive: true });

    const dbPath = join(paths.binder, DB_FILE);
    const dbResult = openDb({ path: dbPath, migrate: true });
    if (isErr(dbResult)) {
      Log.error("Failed to open database", { error: dbResult.error });
      process.exit(1);
    }

    const db = dbResult.data;

    const kg = openKnowledgeGraph(db, {
      onTransactionSaved: (transaction: Transaction) => {
        logTransaction(fs, paths.binder, transaction, TRANSACTION_LOG_FILE)
          .then((result) => {
            if (isErr(result)) {
              Log.error("Failed to log transaction", {
                error: result.error,
              });
              return okVoid;
            }
            return clearTransactionLog(fs, paths.binder, UNDO_LOG_FILE);
          })
          .then((result) => {
            if (isErr(result)) {
              Log.error("Failed to clear undo log", {
                error: result.error,
              });
            }
          });
        renderDocs(kg, config.paths.docs, config.dynamicDirectories).then(
          (renderResult) => {
            if (isErr(renderResult)) {
              Log.error("Failed to re-render docs after transaction", {
                error: renderResult.error,
              });
            }
          },
        );
      },
    });

    return handler({
      ...context,
      db,
      kg,
      fs,
    });
  });
};

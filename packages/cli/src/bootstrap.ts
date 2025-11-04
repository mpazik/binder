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

type CommandContext = {
  config: Config;
  log: typeof Log;
  ui: typeof ui;
};

type CommandContextWithDb = CommandContext & {
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
    const rootResult = findBinderRoot();
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
    const { paths } = context.config;
    mkdirSync(paths.binder, { recursive: true });

    const dbPath = join(paths.binder, DB_FILE);
    const dbResult = openDb({ path: dbPath, migrate: true });
    if (isErr(dbResult)) {
      Log.error("Failed to open database", { error: dbResult.error });
      process.exit(1);
    }

    const db = dbResult.data;
    const transactionLogPath = join(paths.binder, TRANSACTION_LOG_FILE);
    const undoLogPath = join(paths.binder, UNDO_LOG_FILE);

    const kg = openKnowledgeGraph(db, {
      onTransactionSaved: (transaction: Transaction) => {
        logTransaction(transaction, transactionLogPath);
        const clearResult = clearTransactionLog(undoLogPath);
        if (isErr(clearResult)) {
          Log.error("Failed to clear undo log", { error: clearResult.error });
        }
        renderDocs(
          kg,
          context.config.paths.docs,
          context.config.dynamicDirectories,
        ).then((renderResult) => {
          if (isErr(renderResult)) {
            Log.error("Failed to re-render docs after transaction", {
              error: renderResult.error,
            });
          }
        });
      },
    });

    return handler({
      ...context,
      db,
      kg,
    });
  });
};

import { mkdirSync } from "fs";
import * as YAML from "yaml";
import { errorToObject, isErr, type Result, tryCatch } from "@binder/utils";
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
  CONFIG_PATH,
  DB_PATH,
  TRANSACTION_LOG_PATH,
} from "./config.ts";
import * as ui from "./ui.ts";
import { logTransaction } from "./transaction-log.ts";

const loadConfig = async (): Promise<Result<BinderConfig>> => {
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(CONFIG_PATH);
    if (!(await bunFile.exists())) {
      return null;
    }
    const text = await bunFile.text();
    return YAML.parse(text);
  }, errorToObject);

  if (isErr(fileResult)) return fileResult;

  const rawConfig = fileResult.data ?? {};

  return tryCatch(() => BinderConfigSchema.parse(rawConfig), errorToObject);
};

type CommandContext = {
  config: BinderConfig;
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
    const configResult = await loadConfig();
    if (isErr(configResult)) {
      ui.error(`Failed to load config: ${configResult.error.message}`);
      Log.error("Config loading failed", { error: configResult.error });
      process.exit(1);
    }

    const result = await handler({
      config: configResult.data,
      log: Log,
      ui,
      args,
    });

    if (isErr(result)) {
      ui.error(result.error.message || "Command failed");
      Log.error("Command failed", { error: result.error });
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
    mkdirSync(BINDER_DIR, { recursive: true });

    const dbResult = openDb({ path: DB_PATH, migrate: true });
    if (isErr(dbResult)) {
      Log.error("Failed to open database", { error: dbResult.error });
      process.exit(1);
    }

    const db = dbResult.data;
    const kg = openKnowledgeGraph(db, {
      onTransactionSaved: (transaction: Transaction) => {
        logTransaction(transaction, TRANSACTION_LOG_PATH);
      },
    });

    return handler({
      ...context,
      db,
      kg,
    });
  });
};

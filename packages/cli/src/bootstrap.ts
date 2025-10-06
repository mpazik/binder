import { mkdirSync } from "fs";
import { isErr, type Result } from "@binder/utils";
import {
  openDb,
  openKnowledgeGraph,
  type Database,
  type KnowledgeGraph,
  type Transaction,
} from "@binder/db";
import { Log } from "./log.ts";
import { BINDER_DIR, DB_PATH, AUTHOR, TRANSACTION_LOG_PATH } from "./config.ts";
import * as ui from "./ui.ts";
import { logTransaction } from "./transaction-log.ts";

type CommandContext = {
  author: string;
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
    const result = await handler({
      author: AUTHOR,
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

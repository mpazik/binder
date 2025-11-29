import { join } from "path";
import type { Argv } from "yargs";
import {
  createError,
  err,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import {
  normalizeEntityRef,
  type Transaction,
  TransactionInput,
  type TransactionRef,
} from "@binder/db";
import * as YAML from "yaml";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import {
  verifySync,
  repairDbFromLog,
  squashTransactions,
} from "../lib/orchestrator.ts";
import {
  readLastTransactions,
  readTransactions,
  rehashLog,
  verifyLog,
} from "../lib/journal.ts";
import { TRANSACTION_LOG_FILE } from "../config.ts";
import { types } from "./types.ts";

type RawTransactionData = {
  author?: string;
  nodes?: unknown[] | Record<string, unknown>;
  configurations?: unknown[] | Record<string, unknown>;
};

const transformToArray = (
  data: unknown[] | Record<string, unknown> | undefined,
): Record<string, unknown>[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return Object.entries(data).map(([key, value]) => ({
    key,
    ...(typeof value === "object" && value !== null ? value : {}),
  }));
};

export const loadTransactionFromFile = async (
  path: string,
  defaultAuthor: string,
): ResultAsync<TransactionInput> => {
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(path);
    const text = await bunFile.text();
    return YAML.parse(text);
  });

  if (isErr(fileResult))
    return err(
      createError("file-read-error", "Failed to read transaction file", {
        path,
        error: fileResult.error,
      }),
    );

  const rawData = fileResult.data as RawTransactionData;
  const transactionInput = {
    author: rawData.author || defaultAuthor,
    nodes: transformToArray(rawData.nodes),
    configurations: transformToArray(rawData.configurations),
  };

  const validationResult = tryCatch(() =>
    TransactionInput.parse(transactionInput),
  );

  if (isErr(validationResult))
    return err(
      createError("validation-error", "Invalid transaction format", {
        error: validationResult.error,
      }),
    );

  return ok(validationResult.data);
};

export const transactionCreateHandler: CommandHandlerWithDb<{
  path: string;
}> = async ({ kg, config, ui, log, args }) => {
  const path = args.path;

  if (!path) {
    log.error("Path to transaction file is required");
    process.exit(1);
  }

  const transactionResult = await loadTransactionFromFile(path, config.author);

  if (isErr(transactionResult)) {
    log.error("Failed to load transaction", {
      path,
      error: transactionResult.error,
    });
    process.exit(1);
  }

  const result = await kg.update(transactionResult.data);
  if (isErr(result)) return result;

  log.info("Transaction created successfully", { path });
  ui.block(() => {
    ui.printTransaction(result.data);
  });
  ui.success("Transaction created successfully");
  return ok(undefined);
};

export const transactionReadHandler: CommandHandlerWithDb<{
  ref: TransactionRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const transactionRollbackHandler: CommandHandlerWithDb<{
  count: number;
}> = async ({ kg, ui, log, args }) => {
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 1)
    return err(
      createError(
        "invalid-rollback",
        "Cannot rollback the genesis transaction",
      ),
    );

  if (args.count > currentId - 1)
    return err(
      createError(
        "invalid-rollback",
        `Cannot rollback ${args.count} transactions, only ${currentId - 1} available`,
      ),
    );

  const transactionsToRollback: Transaction[] = [];
  for (let i = 0; i < args.count; i++) {
    const txId = (currentId - i) as TransactionRef;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToRollback.push(txResult.data);
  }

  ui.heading(`Rolling back ${args.count} transaction(s)`);
  ui.printTransactions(transactionsToRollback, "concise");

  const rollbackResult = await kg.rollback(args.count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  log.info("Rolled back successfully", { count: args.count });
  ui.success("Rolled back successfully");
  return ok(undefined);
};

export const transactionSquashHandler: CommandHandlerWithDb<{
  count: number;
  yes?: boolean;
}> = async (context) => {
  const { ui, log, config, fs, args } = context;
  const transactionLogPath = join(config.paths.binder, "transactions.jsonl");
  const logResult = await readLastTransactions(
    fs,
    transactionLogPath,
    args.count,
  );
  if (isErr(logResult)) return logResult;

  const transactionsToSquash = logResult.data;

  if (!args.yes) {
    ui.heading(`Squashing ${args.count} transaction(s)`);
    ui.printTransactions(transactionsToSquash, "oneline");

    const uniqueAuthors = Array.from(
      new Set(transactionsToSquash.map((tx) => tx.author)),
    );
    if (uniqueAuthors.length > 1) {
      const newestAuthor =
        transactionsToSquash[transactionsToSquash.length - 1]!.author;
      ui.warning(
        `Authors [${uniqueAuthors.join(", ")}] will be replaced with "${newestAuthor}"`,
      );
      ui.println("");
    }

    if (
      !(await ui.confirm("Do you want to proceed with squashing? (yes/no): "))
    ) {
      ui.info("Squash cancelled");
      return ok(undefined);
    }
  }

  const squashResult = await squashTransactions(context, args.count);
  if (isErr(squashResult)) {
    log.error("Failed to squash transactions", {
      error: squashResult.error,
    });
    return squashResult;
  }

  const squashedTransaction = squashResult.data;

  log.info("Squashed successfully", { count: args.count });
  ui.block(() => {
    ui.success("Squashed successfully");
    ui.info(
      `Transactions ${transactionsToSquash[0]!.id}-${transactionsToSquash[args.count - 1]!.id} merged into transaction #${squashedTransaction.id}`,
    );
  });
  return ok(undefined);
};

export const transactionVerifyHandler: CommandHandlerWithDb = async ({
  kg,
  config,
  ui,
  fs,
}) => {
  const transactionLogPath = join(config.paths.binder, "transactions.jsonl");
  const configSchema = kg.getConfigSchema();
  const nodeSchemaResult = await kg.getNodeSchema();
  if (isErr(nodeSchemaResult)) return nodeSchemaResult;

  const logIntegrityResult = await verifyLog(
    fs,
    configSchema,
    nodeSchemaResult.data,
    transactionLogPath,
    {
      verifyIntegrity: true,
    },
  );
  if (isErr(logIntegrityResult)) {
    if (logIntegrityResult.error.key === "hash-mismatch") {
      ui.block(() => {
        ui.danger("Transaction hash integrity check failed");
        ui.info("One or more transactions have incorrect hashes");
        ui.println("");
        ui.info("This may be caused by:");
        ui.list(
          [
            "Migration to a new hash algorithm",
            "Data corruption",
            "Manual modification of transaction log",
          ],
          2,
        );
        ui.println("");
        ui.info("Run 'binder tx repair --rehash' to recompute all hashes");
      });
    }
    return logIntegrityResult;
  }

  const verifyResult = await verifySync(fs, kg, config.paths.binder);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0) {
    ui.block(() => {
      ui.success("Database and log are in sync");
    });
    return ok(undefined);
  }

  ui.block(() => {
    if (logOnlyTransactions.length > 0 && dbOnlyTransactions.length === 0) {
      ui.warning(
        `Database is behind by ${logOnlyTransactions.length} transaction(s)`,
      );
      ui.info("Run 'binder tx repair' to apply missing transactions");
    } else if (
      dbOnlyTransactions.length > 0 &&
      logOnlyTransactions.length === 0
    ) {
      ui.warning(
        `Database has ${dbOnlyTransactions.length} extra transaction(s) not in log`,
      );
      ui.info("Run 'binder tx repair' to sync");
    } else {
      ui.warning("Database and log have diverged");
      ui.info(`Database has ${dbOnlyTransactions.length} extra transaction(s)`);
      ui.info(`Log has ${logOnlyTransactions.length} new transaction(s)`);
      ui.println("");
      ui.info("Run 'binder tx repair' to sync");
    }
  });

  return err(
    createError("sync-verification-failed", "Database and log are out of sync"),
  );
};

export const transactionRepairHandler: CommandHandlerWithDb<{
  dryRun?: boolean;
  yes?: boolean;
  rehash?: boolean;
}> = async ({ kg, db, config, ui, log, fs, args }) => {
  const transactionLogPath = join(config.paths.binder, TRANSACTION_LOG_FILE);

  if (args.rehash) {
    ui.heading("Rehash transactions");

    ui.warning("This will recompute all transaction hashes");
    ui.println("");

    ui.info("This operation:");
    ui.list(
      [
        "Rewrites the entire transaction chain",
        "Updates all transactions with new hashes",
        "Syncs database with rehashed log",
        "Creates backup in .binder/",
      ],
      2,
    );
    ui.info(
      "This should only be used only for disaster recovery after corruption",
    );
    ui.println("");

    if (!args.yes) {
      if (!(await ui.confirm("Continue with rehash? (yes/no): "))) {
        ui.info("Rehash cancelled");
        return ok(undefined);
      }
    }

    ui.info("Reading transaction log...");

    const configSchema = kg.getConfigSchema();
    const nodeSchemaResult = await kg.getNodeSchema();
    if (isErr(nodeSchemaResult)) return nodeSchemaResult;

    const rehashResult = await rehashLog(
      fs,
      configSchema,
      nodeSchemaResult.data,
      transactionLogPath,
    );
    if (isErr(rehashResult)) {
      log.error("Failed to rehash log", { error: rehashResult.error });
      return rehashResult;
    }

    const { transactionsRehashed, backupPath } = rehashResult.data;

    ui.info("Syncing database with rehashed log...");

    const repairResult = await repairDbFromLog({ db, fs, log, config });
    if (isErr(repairResult)) {
      log.error("Failed to sync database with rehashed log", {
        error: repairResult.error,
      });
      return repairResult;
    }

    const { dbTransactionsPath } = repairResult.data;

    ui.block(() => {
      ui.success("Rehash completed successfully");
      ui.keyValue("Transactions rehashed", transactionsRehashed.toString());
      ui.keyValue("Log backup", backupPath);
      if (dbTransactionsPath) {
        ui.keyValue("Database backup", dbTransactionsPath);
      }
    });

    return ok(undefined);
  }

  const verifyResult = await verifySync(fs, kg, config.paths.binder);
  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0) {
    ui.block(() => {
      ui.success("Database and log are in sync");
    });
    return ok(undefined);
  }

  ui.block(() => {
    if (dbOnlyTransactions.length > 0 && logOnlyTransactions.length === 0) {
      ui.warning(
        `Will rollback ${dbOnlyTransactions.length} transaction(s) from database`,
      );
      ui.info("Backup will be created in .binder");
    } else if (
      logOnlyTransactions.length > 0 &&
      dbOnlyTransactions.length === 0
    ) {
      ui.info(
        `Will apply ${logOnlyTransactions.length} transaction(s) from log`,
      );
    } else {
      ui.warning("Database and log have diverged");
      ui.info(
        `Will rollback ${dbOnlyTransactions.length} transaction(s) from database`,
      );
      ui.info(
        `Will apply ${logOnlyTransactions.length} transaction(s) from log`,
      );
      ui.info("Backup will be created in .binder");
    }
  });

  if (dbOnlyTransactions.length > 0) {
    ui.heading("Transactions to rollback:");
    ui.printTransactions(dbOnlyTransactions, "concise");
  }

  if (logOnlyTransactions.length > 0) {
    ui.heading("Transactions to apply:");
    ui.printTransactions(logOnlyTransactions, "concise");
  }

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return ok(undefined);
  }

  if (!args.yes) {
    ui.println("");
    if (!(await ui.confirm("Do you want to proceed with repair? (yes/no): "))) {
      ui.info("Repair cancelled");
      return ok(undefined);
    }
  }

  const repairResult = await repairDbFromLog({ db, fs, log, config });
  if (isErr(repairResult)) {
    log.error("Failed to repair sync", { error: repairResult.error });
    return repairResult;
  }

  const { dbTransactionsPath } = repairResult.data;

  log.info("Repair completed successfully", {
    rolledBack: dbOnlyTransactions.length,
    applied: logOnlyTransactions.length,
  });

  ui.block(() => {
    ui.success("Repair completed successfully");
    if (dbOnlyTransactions.length > 0) {
      ui.info(`Rolled back ${dbOnlyTransactions.length} transaction(s)`);
    }
    if (logOnlyTransactions.length > 0) {
      ui.info(`Applied ${logOnlyTransactions.length} transaction(s)`);
    }
    if (dbTransactionsPath) {
      ui.info(`Backup created: ${dbTransactionsPath}`);
    }
  });

  return ok(undefined);
};

export const transactionLogHandler: CommandHandlerWithDb<{
  count: number;
  format: string;
  oneline?: boolean;
  author?: string;
  chronological?: boolean;
}> = async ({ config, ui, fs, args }) => {
  const transactionLogPath = join(config.paths.binder, TRANSACTION_LOG_FILE);

  const logResult = await readTransactions(
    fs,
    transactionLogPath,
    args.count,
    { author: args.author },
    args.chronological ? "asc" : "desc",
  );
  if (isErr(logResult)) return logResult;

  const transactions = logResult.data;

  if (args.format === "json") {
    ui.println(JSON.stringify(transactions, null, 2));
    return ok(undefined);
  }

  if (args.format === "yaml") {
    ui.printData(transactions);
    return ok(undefined);
  }

  const format = args.oneline
    ? "oneline"
    : args.format === "full"
      ? "full"
      : "concise";

  for (const tx of transactions) {
    ui.printTransaction(tx, format);
    if (format !== "oneline") {
      ui.divider();
    }
  }
  return ok(undefined);
};

const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "create transactions",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "create [path]",
          aliases: ["add"],
          describe: "create a transaction from a YAML file",
          builder: (yargs: Argv) => {
            return yargs.positional("path", {
              describe: "path to transaction YAML file",
              type: "string",
              demandOption: true,
            });
          },
          handler: runtimeWithDb(transactionCreateHandler),
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a transaction by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "transaction reference (id | hash)",
              type: "string",
              demandOption: true,
              coerce: (value: string) =>
                normalizeEntityRef<"transaction">(value),
            });
          },
          handler: runtimeWithDb(transactionReadHandler),
        }),
      )
      .command(
        types({
          command: "rollback [count]",
          describe: "rollback the last N transactions",
          builder: (yargs: Argv) => {
            return yargs.positional("count", {
              describe: "number of transactions to rollback",
              type: "number",
              default: 1,
            });
          },
          handler: runtimeWithDb(transactionRollbackHandler),
        }),
      )
      .command(
        types({
          command: "squash [count]",
          describe: "squash the last N transactions into one",
          builder: (yargs: Argv) => {
            return yargs
              .positional("count", {
                describe: "number of transactions to squash",
                type: "number",
                default: 2,
              })
              .option("yes", {
                alias: "y",
                describe: "auto-confirm all prompts",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(transactionSquashHandler),
        }),
      )
      .command(
        types({
          command: "verify",
          describe: "verify database and log are in sync",
          handler: runtimeWithDb(transactionVerifyHandler),
        }),
      )
      .command(
        types({
          command: "repair",
          describe:
            "repair database and log sync by applying missing transactions",
          builder: (yargs: Argv) => {
            return yargs
              .option("dry-run", {
                alias: "d",
                describe: "show what would be done without making changes",
                type: "boolean",
                default: false,
              })
              .option("yes", {
                alias: "y",
                describe: "auto-confirm all prompts",
                type: "boolean",
                default: false,
              })
              .option("rehash", {
                describe:
                  "recompute all transaction hashes (use for algorithm migration)",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(transactionRepairHandler),
        }),
      )
      .command(
        types({
          command: "log",
          describe: "show recent transactions from the log",
          builder: (yargs: Argv) => {
            return yargs
              .option("count", {
                alias: "n",
                describe: "number of transactions to show",
                type: "number",
                default: 10,
              })
              .option("format", {
                alias: "f",
                describe: "output format",
                type: "string",
                choices: ["compact", "full", "oneline", "json", "yaml"],
                default: "compact",
              })
              .option("oneline", {
                describe:
                  "show one transaction per line (shorthand for --format oneline)",
                type: "boolean",
                default: false,
              })
              .option("author", {
                describe: "filter transactions by author",
                type: "string",
              })
              .option("chronological", {
                describe:
                  "show transactions in chronological order (oldest first)",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(transactionLogHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: create, read, rollback, squash, verify, repair, log",
      );
  },
  handler: async () => {},
});
export default TransactionCommand;

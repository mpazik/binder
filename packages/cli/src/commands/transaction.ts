import { join } from "path";
import type { Argv } from "yargs";
import {
  createError,
  err,
  errorToObject,
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
import {
  bootstrapWithDbRead,
  bootstrapWithDbWrite,
  type CommandHandlerWithDbRead,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import {
  verifySync,
  repairDbFromLog,
  squashTransactions,
} from "../lib/orchestrator.ts";
import { readLastTransactions, verifyLog } from "../lib/journal.ts";
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
  }, errorToObject);

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

  const validationResult = tryCatch(
    () => TransactionInput.parse(transactionInput),
    errorToObject,
  );

  if (isErr(validationResult))
    return err(
      createError("validation-error", "Invalid transaction format", {
        error: validationResult.error,
      }),
    );

  return ok(validationResult.data);
};

export const transactionCreateHandler: CommandHandlerWithDbWrite<{
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

export const transactionReadHandler: CommandHandlerWithDbRead<{
  ref: TransactionRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const transactionRollbackHandler: CommandHandlerWithDbWrite<{
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

  ui.printTransactions(
    transactionsToRollback,
    `Rolling back ${args.count} transaction(s)`,
  );

  const rollbackResult = await kg.rollback(args.count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  log.info("Rolled back successfully", { count: args.count });
  ui.success("Rolled back successfully");
  return ok(undefined);
};

export const transactionSquashHandler: CommandHandlerWithDbWrite<{
  count: number;
  yes?: boolean;
}> = async ({ db, ui, log, config, fs, args }) => {
  const transactionLogPath = join(config.paths.binder, "transactions.jsonl");
  const logResult = await readLastTransactions(
    fs,
    transactionLogPath,
    args.count,
  );
  if (isErr(logResult)) return logResult;

  const transactionsToSquash = logResult.data;

  if (!args.yes) {
    ui.printTransactions(
      transactionsToSquash,
      `Squashing ${args.count} transaction(s)`,
    );

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

  const squashResult = await squashTransactions(
    fs,
    db,
    config.paths.binder,
    config.paths.docs,
    config.dynamicDirectories,
    log,
    args.count,
  );
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

export const transactionVerifyHandler: CommandHandlerWithDbRead = async ({
  kg,
  config,
  ui,
  fs,
}) => {
  const transactionLogPath = join(config.paths.binder, "transactions.jsonl");
  const logIntegrityResult = await verifyLog(fs, transactionLogPath, {
    verifyIntegrity: true,
  });
  if (isErr(logIntegrityResult)) return logIntegrityResult;

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
      ui.info("Run 'binder tx repair' to rollback and sync");
    } else {
      ui.warning("Database and log have diverged");
      ui.info(`Database has ${dbOnlyTransactions.length} extra transaction(s)`);
      ui.info(`Log has ${logOnlyTransactions.length} new transaction(s)`);
      ui.println("");
      ui.info("Run 'binder tx repair' to rollback and sync");
    }
  });

  return err(
    createError("sync-verification-failed", "Database and log are out of sync"),
  );
};

export const transactionRepairHandler: CommandHandlerWithDbWrite<{
  dryRun?: boolean;
  yes?: boolean;
}> = async ({ kg, db, config, ui, log, fs, args }) => {
  const verifyResult = await verifySync(fs, kg, config.paths.binder);

  if (isErr(verifyResult)) return verifyResult;

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0) {
    ui.block(() => {
      ui.success("Database and log are in sync");
    });
    return ok(undefined);
  }

  if (dbOnlyTransactions.length > 0) {
    ui.printTransactions(
      dbOnlyTransactions,
      `Rolling back ${dbOnlyTransactions.length} transaction(s) from database`,
    );
  }

  if (logOnlyTransactions.length > 0) {
    ui.printTransactions(
      logOnlyTransactions,
      `Applying ${logOnlyTransactions.length} transaction(s) from log`,
    );
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

  const repairResult = await repairDbFromLog(fs, db, config.paths.binder);
  if (isErr(repairResult)) {
    log.error("Failed to repair sync", { error: repairResult.error });
    return repairResult;
  }

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
  });

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
          handler: bootstrapWithDbWrite(transactionCreateHandler),
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
          handler: bootstrapWithDbRead(transactionReadHandler),
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
          handler: bootstrapWithDbWrite(transactionRollbackHandler),
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
          handler: bootstrapWithDbWrite(transactionSquashHandler),
        }),
      )
      .command(
        types({
          command: "verify",
          describe: "verify database and log are in sync",
          handler: bootstrapWithDbRead(transactionVerifyHandler),
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
              });
          },
          handler: bootstrapWithDbWrite(transactionRepairHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: create, read, rollback, squash, verify, repair",
      );
  },
  handler: async () => {},
});
export default TransactionCommand;

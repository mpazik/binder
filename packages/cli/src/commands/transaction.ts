import { join } from "path";
import type { Argv } from "yargs";
import { createError, err, fail, isErr, ok } from "@binder/utils";
import {
  normalizeEntityRef,
  normalizeTransactionInput,
  type Transaction,
  type TransactionInput,
  type TransactionRef,
  transactionToInput,
  TransactionInputSchema,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import {
  repairDbFromLog,
  squashTransactions,
  verifySync,
} from "../lib/orchestrator.ts";
import {
  readLastTransactions,
  readTransactionRange,
  readTransactions,
  rehashLog,
  verifyLog,
} from "../lib/journal.ts";
import { TRANSACTION_LOG_FILE } from "../config.ts";
import {
  detectFileFormat,
  parseTransactionInputContent,
} from "../utils/parse.ts";
import { isStdinPiped, parseStdinAs } from "../cli/stdin.ts";
import { types } from "../cli/types.ts";
import { dryRunOption, itemFormatOption, yesOption } from "../cli/options.ts";
import { serialize, type SerializeItemFormat } from "../utils/serialize.ts";

export const transactionImportHandler: CommandHandlerWithDb<{
  files?: string[];
  dryRun?: boolean;
  yes?: boolean;
}> = async ({ kg, config, ui, log, fs, args }) => {
  const allInputs: TransactionInput[] = [];
  const files = args.files ?? [];

  if (files.length > 0 && isStdinPiped())
    return fail(
      "conflicting-input",
      "Cannot combine stdin with file arguments",
    );

  if (files.length === 0 && isStdinPiped()) {
    const parseResult = await parseStdinAs(
      TransactionInputSchema,
      undefined,
      (raw) => ({
        ...(raw as object),
        author: (raw as { author?: string }).author ?? config.author,
      }),
    );
    if (isErr(parseResult)) return parseResult;
    allInputs.push(...parseResult.data);
  } else if (files.length === 0) {
    return fail("no-input", "Provide file path(s) or pipe content via stdin");
  } else {
    for (const path of files) {
      const contentResult = await fs.readFile(path);
      if (isErr(contentResult)) return contentResult;

      const parseResult = parseTransactionInputContent(
        contentResult.data,
        detectFileFormat(path),
        config.author,
      );
      if (isErr(parseResult)) return parseResult;
      allInputs.push(...parseResult.data);
    }
  }

  if (allInputs.length === 0)
    return fail(
      "no-transactions",
      "No transactions found in the provided files",
    );

  ui.heading(`Importing ${allInputs.length} transaction(s)`);
  for (const input of allInputs) {
    const nodeCount = input.nodes?.length ?? 0;
    const configCount = input.configurations?.length ?? 0;
    const parts: string[] = [`author "${input.author}"`];
    if (nodeCount > 0) parts.push(`${nodeCount} node(s)`);
    if (configCount > 0) parts.push(`${configCount} config(s)`);
    ui.info(`  ${parts.join(", ")}`);
  }

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return ok(undefined);
  }

  if (!args.yes) {
    ui.println("");
    if (!(await ui.confirm("Do you want to proceed with import? (yes/no): "))) {
      ui.info("Import cancelled");
      return ok(undefined);
    }
  }

  const results: Transaction[] = [];
  for (const input of allInputs) {
    const result = await kg.update(input);
    if (isErr(result)) return result;
    results.push(result.data);
  }

  log.info("Import completed successfully", { count: results.length });
  ui.block(() => {
    ui.success(`Imported ${results.length} transaction(s) successfully`);
    for (const tx of results) {
      ui.printTransaction(tx, "oneline");
    }
  });
  return ok(undefined);
};

export const transactionReadHandler: CommandHandlerWithDb<{
  ref: TransactionRef;
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
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

  if (args.format === "jsonl") {
    for (const tx of transactions) {
      ui.println(JSON.stringify(tx));
    }
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

export const transactionExportHandler: CommandHandlerWithDb<{
  output?: string;
  last: number;
  from?: number;
  to?: number;
}> = async ({ config, ui, fs, args }) => {
  const transactionLogPath = join(config.paths.binder, TRANSACTION_LOG_FILE);

  const transactionsResult =
    args.from !== undefined || args.to !== undefined
      ? await readTransactionRange(fs, transactionLogPath, args.from, args.to)
      : await readLastTransactions(fs, transactionLogPath, args.last);

  if (isErr(transactionsResult)) return transactionsResult;

  const inputs = transactionsResult.data.map(transactionToInput);
  const format = args.output ? detectFileFormat(args.output) : "jsonl";
  const serialized = serialize(inputs, format, normalizeTransactionInput);

  if (args.output) {
    const writeResult = await fs.writeFile(args.output, serialized);
    if (isErr(writeResult)) return writeResult;
    ui.success(`Exported ${inputs.length} transaction(s) to ${args.output}`);
  } else {
    ui.println(serialized);
  }

  return ok(undefined);
};

export const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "create transactions",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "import [files...]",
          aliases: ["create", "add"],
          describe: "import transactions from file(s) or stdin",
          builder: (yargs: Argv) => {
            return yargs
              .positional("files", {
                describe: "path(s) to transaction file(s), or pipe via stdin",
                type: "string",
                array: true,
              })
              .options({ ...dryRunOption, ...yesOption });
          },
          handler: runtimeWithDb(transactionImportHandler),
        }),
      )
      .command(
        types({
          command: "export",
          describe: "export transactions as TransactionInput format",
          builder: (yargs: Argv) => {
            return yargs
              .option("output", {
                alias: "o",
                describe:
                  "output file (format from extension: .yaml, .json, .jsonl)",
                type: "string",
              })
              .option("last", {
                alias: "n",
                describe: "export last N transactions",
                type: "number",
                default: 1,
              })
              .option("from", {
                describe: "export starting from transaction ID",
                type: "number",
              })
              .option("to", {
                describe: "export up to transaction ID",
                type: "number",
              });
          },
          handler: runtimeWithDb(transactionExportHandler),
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a transaction by reference",
          builder: (yargs: Argv) => {
            return yargs
              .positional("ref", {
                describe: "transaction reference (id | hash)",
                type: "string",
                demandOption: true,
                coerce: (value: string) =>
                  normalizeEntityRef<"transaction">(value),
              })
              .options(itemFormatOption);
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
              .options(yesOption);
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
              .options({ ...dryRunOption, ...yesOption })
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
                choices: [
                  "compact",
                  "full",
                  "oneline",
                  "json",
                  "jsonl",
                  "yaml",
                ],
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
        "You need to specify a subcommand: import, export, read, rollback, squash, verify, repair, log",
      );
  },
  handler: async () => {},
});

import { join } from "path";
import type { Argv } from "yargs";
import { fail, includes, isErr, okVoid, wrapError } from "@binder/utils";
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
import { isStdinPiped, readStdinAsArray } from "../cli/stdin.ts";
import { types } from "../cli/types.ts";
import {
  confirmProtected,
  dryRunOption,
  itemFormatOption,
  selectionOptions,
  yesOption,
} from "../cli/options.ts";
import { resolveTransactionDisplayKeys, type Ui } from "../cli/ui.ts";
import {
  serialize,
  serializeFormats,
  type SerializeItemFormat,
} from "../utils/serialize.ts";
import { applySelection, type SelectionArgs } from "../utils/selection.ts";
import { withPager } from "../cli/pager.ts";

const transactionInputSummary = (input: TransactionInput): string =>
  [
    input.records?.length && `${input.records.length} record(s)`,
    input.configs?.length && `${input.configs.length} config(s)`,
  ]
    .filter(Boolean)
    .join(", ");

export const transactionImportHandler: CommandHandlerWithDb<
  {
    files?: string[];
    dryRun?: boolean;
  } & SelectionArgs
> = async ({ kg, config, ui, log, fs, args }) => {
  let allInputs: TransactionInput[] = [];
  const files = args.files ?? [];

  if (files.length > 0 && isStdinPiped())
    return fail(
      "conflicting-input",
      "Cannot combine stdin with file arguments",
    );

  if (files.length === 0 && isStdinPiped()) {
    const parseResult = await readStdinAsArray(
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

  allInputs = applySelection(allInputs, args);

  if (allInputs.length === 0)
    return fail(
      "no-transactions-after-selection",
      "No transactions remaining after applying selection",
    );

  ui.heading(`Importing ${allInputs.length} transaction(s)`);
  for (const input of allInputs) {
    const summary = transactionInputSummary(input);
    const detail = summary ? `, ${summary}` : "";
    ui.info(`  author "${input.author}"${detail}`);
  }

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return okVoid;
  }

  const results: Transaction[] = [];
  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i]!;
    const result = await kg.update(input);
    if (isErr(result)) {
      const summary = transactionInputSummary(input);
      const suffix = summary ? ` (${summary})` : "";
      return wrapError(
        result,
        `Failed to import transaction ${i + 1}${suffix}`,
        {
          data: { transactionIndex: i + 1, author: input.author },
        },
      );
    }
    results.push(result.data);
  }

  log.info("Import completed successfully", { count: results.length });

  const resolved = await resolveTransactionDisplayKeys(kg, results);
  ui.block(() => {
    ui.success(`Imported ${results.length} transaction(s) successfully`);
    for (const tx of resolved) {
      ui.printRawTransaction(tx, "oneline");
    }
  });
  return okVoid;
};

export const transactionReadHandler: CommandHandlerWithDb<{
  ref: TransactionRef;
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return okVoid;
};

export const transactionRollbackHandler: CommandHandlerWithDb<{
  count: number;
  yes?: boolean;
}> = async ({ kg, ui, log, args }) => {
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 1)
    return fail("invalid-rollback", "Cannot rollback the genesis transaction");

  if (args.count > currentId - 1)
    return fail(
      "invalid-rollback",
      `Cannot rollback ${args.count} transactions, only ${currentId - 1} available`,
    );

  const transactionsToRollback: Transaction[] = [];
  for (let i = 0; i < args.count; i++) {
    const txId = (currentId - i) as TransactionRef;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToRollback.push(txResult.data);
  }

  ui.heading(`Rolling back ${args.count} transaction(s)`);

  await ui.printTransactions(kg, transactionsToRollback, "concise");

  const confirmResult = await confirmProtected(
    ui,
    args,
    "Do you want to proceed with rollback? (yes/no): ",
  );
  if (isErr(confirmResult)) return confirmResult;
  if (!confirmResult.data) {
    ui.info("Rollback cancelled");
    return okVoid;
  }

  const rollbackResult = await kg.rollback(args.count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  log.info("Rolled back successfully", { count: args.count });
  ui.success("Rolled back successfully");
  return okVoid;
};

export const transactionSquashHandler: CommandHandlerWithDb<{
  count: number;
  yes?: boolean;
}> = async (context) => {
  const { kg, ui, log, config, fs, args } = context;
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);
  const logResult = await readLastTransactions(
    fs,
    transactionLogPath,
    args.count,
  );
  if (isErr(logResult)) return logResult;

  const transactionsToSquash = logResult.data;

  ui.heading(`Squashing ${args.count} transaction(s)`);

  await ui.printTransactions(kg, transactionsToSquash, "oneline");

  const uniqueAuthors = Array.from(
    new Set(transactionsToSquash.map((tx) => tx.author)),
  );
  if (uniqueAuthors.length > 1) {
    const newestAuthor =
      transactionsToSquash[transactionsToSquash.length - 1]!.author;
    ui.warning(
      `Authors [${uniqueAuthors.join(", ")}] will be replaced with "${newestAuthor}"`,
    );
  }

  const confirmResult = await confirmProtected(
    ui,
    args,
    "Do you want to proceed with squashing? (yes/no): ",
  );
  if (isErr(confirmResult)) return confirmResult;
  if (!confirmResult.data) {
    ui.info("Squash cancelled");
    return okVoid;
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
  return okVoid;
};

const printChainError = (ui: Ui) => {
  ui.block(() => {
    ui.danger("Transaction chain broken");
    ui.info("The transaction log has a broken previous-hash link.");
    ui.println("");
    ui.info("This may be caused by:");
    ui.list(
      [
        "Manual modification of the transaction log file",
        "An external script or sync tool modified or overwrote the log",
        "A bug in binder. Try updating to the latest version or report it.",
      ],
      2,
    );
    ui.println("");
    ui.info("Run 'binder tx repair --rehash' to rebuild the transaction chain");
  });
};

export const transactionVerifyHandler: CommandHandlerWithDb = async ({
  kg,
  config,
  ui,
  fs,
}) => {
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);

  const logIntegrityResult = await verifyLog(fs, transactionLogPath, {
    verifyIntegrity: true,
  });
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
    } else if (logIntegrityResult.error.key === "chain-error") {
      printChainError(ui);
    }
    return logIntegrityResult;
  }

  const verifyResult = await verifySync({ fs, kg }, config.paths.data);
  if (isErr(verifyResult)) {
    if (verifyResult.error.key === "chain-error") {
      printChainError(ui);
    }
    return verifyResult;
  }

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0) {
    ui.block(() => {
      ui.success("Database and log are in sync");
    });
    return okVoid;
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

  return fail("sync-verification-failed", "Database and log are out of sync");
};

export const transactionRepairHandler: CommandHandlerWithDb<{
  dryRun?: boolean;
  yes?: boolean;
  rehash?: boolean;
}> = async (ctx) => {
  const { kg, config, ui, log, fs, args } = ctx;
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);

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
        "Creates backup in .binder/data/backups/",
      ],
      2,
    );
    ui.info(
      "This should only be used only for disaster recovery after corruption",
    );
    ui.println("");

    const confirmResult = await confirmProtected(
      ui,
      args,
      "Continue with rehash? (yes/no): ",
    );
    if (isErr(confirmResult)) return confirmResult;
    if (!confirmResult.data) {
      ui.info("Rehash cancelled");
      return okVoid;
    }

    ui.info("Reading transaction log...");

    const rehashResult = await rehashLog(fs, transactionLogPath, {
      backupDir: config.paths.backups,
    });
    if (isErr(rehashResult)) {
      log.error("Failed to rehash log", { error: rehashResult.error });
      return rehashResult;
    }

    const { transactionsRehashed, backupPath } = rehashResult.data;

    ui.info("Syncing database with rehashed log...");

    const repairResult = await repairDbFromLog(ctx);
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

    return okVoid;
  }

  const verifyResult = await verifySync({ fs, kg }, config.paths.data);
  if (isErr(verifyResult)) {
    if (verifyResult.error.key === "chain-error") {
      printChainError(ui);
    }
    return verifyResult;
  }

  const { dbOnlyTransactions, logOnlyTransactions } = verifyResult.data;

  if (dbOnlyTransactions.length === 0 && logOnlyTransactions.length === 0) {
    ui.block(() => {
      ui.success("Database and log are in sync");
    });
    return okVoid;
  }

  ui.block(() => {
    if (dbOnlyTransactions.length > 0 && logOnlyTransactions.length === 0) {
      ui.warning(
        `Will rollback ${dbOnlyTransactions.length} transaction(s) from database`,
      );
      ui.info("Backup will be created in .binder/data/backups");
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
      ui.info("Backup will be created in .binder/data/backups");
    }
  });

  if (dbOnlyTransactions.length > 0) {
    ui.heading("Transactions to rollback:");
    await ui.printTransactions(kg, dbOnlyTransactions, "concise");
  }

  if (logOnlyTransactions.length > 0) {
    ui.heading("Transactions to apply:");
    await ui.printTransactions(kg, logOnlyTransactions, "concise");
  }

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return okVoid;
  }

  if (dbOnlyTransactions.length > 0) {
    const confirmResult = await confirmProtected(
      ui,
      args,
      "Do you want to proceed with repair? (yes/no): ",
    );
    if (isErr(confirmResult)) return confirmResult;
    if (!confirmResult.data) {
      ui.info("Repair cancelled");
      return okVoid;
    }
  }

  const repairResult = await repairDbFromLog(ctx);
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

  return okVoid;
};

export const transactionLogHandler: CommandHandlerWithDb<
  {
    format: string;
    oneline?: boolean;
    author?: string;
    chronological?: boolean;
  } & SelectionArgs
> = async ({ kg, config, ui, fs, args }) => {
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);

  const count = args.last ?? args.limit ?? 10;
  const readCount = count + (args.skip ?? 0);

  const logResult = await readTransactions(
    fs,
    transactionLogPath,
    readCount,
    { author: args.author },
    args.chronological ? "asc" : "desc",
  );
  if (isErr(logResult)) return logResult;

  const transactions = applySelection(logResult.data, args);

  if (includes(serializeFormats, args.format)) {
    ui.printData(transactions, args.format);
    return okVoid;
  }

  const format = args.oneline
    ? "oneline"
    : args.format === "full"
      ? "full"
      : "concise";

  const resolved = await resolveTransactionDisplayKeys(kg, transactions);
  const dividerWidth =
    format !== "oneline"
      ? 61 + Math.max(...resolved.map((tx) => tx.author.length))
      : 0;
  await withPager(() => {
    for (const tx of resolved) {
      ui.printRawTransaction(tx, format);
      if (format !== "oneline") {
        ui.divider(dividerWidth);
      }
    }
  });
  return okVoid;
};

export const transactionExportHandler: CommandHandlerWithDb<{
  output?: string;
  last: number;
  from?: number;
  to?: number;
}> = async ({ config, ui, fs, args }) => {
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);

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

  return okVoid;
};

export const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "manage transactions",
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
              .options({ ...dryRunOption, ...selectionOptions });
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
            return yargs
              .positional("count", {
                describe: "number of transactions to rollback",
                type: "number",
                default: 1,
              })
              .options(yesOption);
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
              .options(selectionOptions)
              .option("format", {
                describe: "output format",
                type: "string",
                choices: ["concise", "full", "oneline", ...serializeFormats],
                default: "concise",
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

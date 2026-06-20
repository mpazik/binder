import { join } from "node:path";
import type { Argv } from "yargs";
import { fail, isErr, okVoid } from "@binder/utils";
import { type CommandHandlerWithDb, runtimeWithDb } from "../../runtime.ts";
import { TRANSACTION_LOG_FILE } from "../../config.ts";
import {
  confirmProtected,
  dryRunOption,
  yesOption,
} from "../../cli/options.ts";
import { resolveTransactionDisplayKeys, type Ui } from "../../cli/ui.ts";
import { types } from "../../cli/types.ts";
import { rehashLog, verifyLog } from "./integrity.ts";
import { repairDbFromLog, repairLogFromDb, verifySync } from "./sync.ts";

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
    ui.info(
      "Run 'binder journal repair --rehash' to rebuild the transaction chain",
    );
  });
};

export const journalVerifyHandler: CommandHandlerWithDb = async ({
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
        ui.info("Run 'binder journal repair --rehash' to recompute all hashes");
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
        `Log has ${logOnlyTransactions.length} transaction(s) not in database`,
      );
      ui.info(
        "Run 'binder journal repair --from-log' to apply missing transactions",
      );
    } else if (
      dbOnlyTransactions.length > 0 &&
      logOnlyTransactions.length === 0
    ) {
      ui.warning(
        `Log is behind by ${dbOnlyTransactions.length} transaction(s)`,
      );
      ui.info("Run 'binder journal repair' to sync log from database");
    } else {
      ui.warning("Database and log have diverged");
      ui.info(`Log has ${logOnlyTransactions.length} extra transaction(s)`);
      ui.info(`Log is missing ${dbOnlyTransactions.length} transaction(s)`);
      ui.println("");
      ui.info("Run 'binder journal repair' to sync log from database");
      ui.info(
        "Or 'binder journal repair --from-log' to sync database from log",
      );
    }
  });

  return fail("sync-verification-failed", "Database and log are out of sync");
};

export const journalRepairHandler: CommandHandlerWithDb<{
  dryRun?: boolean;
  yes?: boolean;
  fromLog?: boolean;
  rehash?: boolean;
  force?: boolean;
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
    ui.info("This should only be used for disaster recovery after corruption");
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

  if (args.fromLog) {
    // Log is authoritative — disaster recovery mode.
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
      const resolved = await resolveTransactionDisplayKeys(
        kg,
        dbOnlyTransactions,
      );
      for (const tx of resolved) {
        ui.printRawTransaction(tx, "concise");
      }
    }

    if (logOnlyTransactions.length > 0) {
      ui.heading("Transactions to apply:");
      const resolved = await resolveTransactionDisplayKeys(
        kg,
        logOnlyTransactions,
      );
      for (const tx of resolved) {
        ui.printRawTransaction(tx, "concise");
      }
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
        "Do you want to proceed with repair from log? (yes/no): ",
      );
      if (isErr(confirmResult)) return confirmResult;
      if (!confirmResult.data) {
        ui.info("Repair cancelled");
        return okVoid;
      }
    }

    const repairResult = await repairDbFromLog(ctx);
    if (isErr(repairResult)) {
      log.error("Failed to repair from log", { error: repairResult.error });
      return repairResult;
    }

    const { dbTransactionsPath } = repairResult.data;

    log.info("Repair from log completed successfully", {
      rolledBack: dbOnlyTransactions.length,
      applied: logOnlyTransactions.length,
    });

    ui.block(() => {
      ui.success("Repair from log completed successfully");
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
  }

  // Default: DB is authoritative.
  ui.block(() => {
    if (dbOnlyTransactions.length > 0 && logOnlyTransactions.length === 0) {
      ui.info(
        `Will append ${dbOnlyTransactions.length} transaction(s) to log from database`,
      );
    } else if (
      logOnlyTransactions.length > 0 &&
      dbOnlyTransactions.length === 0
    ) {
      if (args.force) {
        ui.warning(
          `Will overwrite log from database (discards ${logOnlyTransactions.length} log-only transaction(s))`,
        );
      } else {
        ui.warning(
          `Log has ${logOnlyTransactions.length} transaction(s) not in database`,
        );
        ui.info("Use --from-log to treat log as authoritative");
        ui.info("Or --force to overwrite log from database");
      }
    } else {
      ui.warning("Database and log have diverged");
      ui.info(
        `Will append ${dbOnlyTransactions.length} transaction(s) to log from database`,
      );
      if (args.force) {
        ui.warning(
          `Will also discard ${logOnlyTransactions.length} log-only transaction(s)`,
        );
      } else {
        ui.info(
          `Log has ${logOnlyTransactions.length} extra transaction(s) — use --force to overwrite`,
        );
      }
    }
  });

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return okVoid;
  }

  if (logOnlyTransactions.length > 0 && !args.force) {
    return fail(
      "log-ahead",
      `Log has ${logOnlyTransactions.length} transaction(s) not in database. Use --from-log or --force.`,
    );
  }

  if (args.force && logOnlyTransactions.length > 0) {
    const confirmResult = await confirmProtected(
      ui,
      args,
      `Discard ${logOnlyTransactions.length} log-only transaction(s) and overwrite log from database? (yes/no): `,
    );
    if (isErr(confirmResult)) return confirmResult;
    if (!confirmResult.data) {
      ui.info("Repair cancelled");
      return okVoid;
    }
  }

  const repairResult = await repairLogFromDb(ctx, { force: args.force });
  if (isErr(repairResult)) {
    log.error("Failed to repair log from database", {
      error: repairResult.error,
    });
    return repairResult;
  }

  const { logBackupPath } = repairResult.data;

  log.info("Repair completed successfully", {
    appended: dbOnlyTransactions.length,
  });

  ui.block(() => {
    ui.success("Repair completed successfully");
    if (dbOnlyTransactions.length > 0) {
      ui.info(`Appended ${dbOnlyTransactions.length} transaction(s) to log`);
    }
    if (logBackupPath) {
      ui.info(`Backup created: ${logBackupPath}`);
    }
  });

  return okVoid;
};

export const JournalCommand = types({
  command: "journal <command>",
  describe: "manage transaction journal",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "verify",
          describe: "verify database and log are in sync",
          handler: runtimeWithDb(journalVerifyHandler),
        }),
      )
      .command(
        types({
          command: "repair",
          describe:
            "repair log from database (default) or database from log (--from-log)",
          builder: (yargs: Argv) => {
            return yargs
              .options({ ...dryRunOption, ...yesOption })
              .option("from-log", {
                describe: "treat log as authoritative (disaster recovery)",
                type: "boolean",
                default: false,
              })
              .option("rehash", {
                describe:
                  "recompute all transaction hashes, then sync DB from log",
                type: "boolean",
                default: false,
              })
              .option("force", {
                describe:
                  "overwrite log from DB even when log has extra transactions",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(journalRepairHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: verify, repair");
  },
  handler: async () => {},
});

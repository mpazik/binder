import { join } from "path";
import { renameSync, copyFileSync } from "fs";
import type { Argv } from "yargs";
import {
  fail,
  getTimestampForFileName,
  isErr,
  okVoid,
  tryCatch,
} from "@binder/utils";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import {
  DB_FILE,
  LOCK_FILE,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
} from "../config.ts";
import { repairDbFromLog } from "../lib/orchestrator.ts";
import { verifyLog } from "../lib/journal.ts";
import { types } from "../cli/types.ts";

export const backupHandler: CommandHandlerWithDb = async ({
  ui,
  fs,
  config,
}) => {
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);
  const backupPath = join(config.paths.backups, `${TRANSACTION_LOG_FILE}.bac`);

  if (!(await fs.exists(transactionLogPath)))
    return fail("no-transaction-log", "No transaction log to backup", {
      data: { path: transactionLogPath },
    });

  const verifyResult = await verifyLog(fs, transactionLogPath, {
    verifyIntegrity: false,
  });
  if (isErr(verifyResult))
    return fail(
      "invalid-transaction",
      "Transaction log verification failed: " + verifyResult.error.message,
    );

  let renamedBackup: string | null = null;
  if (await fs.exists(backupPath)) {
    const timestampedBackup = join(
      config.paths.backups,
      `${TRANSACTION_LOG_FILE}.${getTimestampForFileName()}.bac`,
    );

    const moveResult = tryCatch(() =>
      renameSync(backupPath, timestampedBackup),
    );
    if (isErr(moveResult))
      return fail("backup-rename-failed", "Failed to rename existing backup", {
        data: { error: moveResult.error },
      });
    renamedBackup = timestampedBackup;
  }

  const copyResult = tryCatch(() => {
    copyFileSync(transactionLogPath, backupPath);
  });

  if (isErr(copyResult))
    return fail("backup-copy-failed", "Failed to create backup", {
      data: { error: copyResult.error },
    });

  const items: string[] = [
    `Backed up to ${TRANSACTION_LOG_FILE}.bac`,
    ...(renamedBackup
      ? [`Previous backup moved to ${renamedBackup.split("/").pop()}`]
      : []),
    `Verified ${verifyResult.data.count} transactions`,
  ];

  ui.block(() => {
    ui.success("Backup created");
    ui.list(items);
  });

  return okVoid;
};

export const resetHandler: CommandHandlerWithDb = async (ctx) => {
  const { ui, fs, config, log } = ctx;
  const {
    binder: binderPath,
    data: dataPath,
    backups: backupsPath,
  } = config.paths;
  const backupPath = join(backupsPath, `${TRANSACTION_LOG_FILE}.bac`);
  const transactionLogPath = join(dataPath, TRANSACTION_LOG_FILE);

  if (!(await fs.exists(backupPath)))
    return fail(
      "backup-not-found",
      `Backup file ${TRANSACTION_LOG_FILE}.bac is required. Run 'binder dev backup' first.`,
    );

  const verifyResult = await verifyLog(fs, backupPath, {
    verifyIntegrity: true,
  });
  if (isErr(verifyResult))
    return fail(
      "backup-verification-failed",
      "Backup file verification failed",
      {
        data: { error: verifyResult.error },
      },
    );

  const { count } = verifyResult.data;

  ui.block(() => {
    ui.info("Resetting workspace:");
    ui.list([
      `Restore ${count} transactions from backup`,
      `Delete database (${DB_FILE})`,
      `Delete undo log (${UNDO_LOG_FILE})`,
      `Delete logs directory`,
      `Delete lock file (${LOCK_FILE})`,
    ]);
  });

  const copyResult = tryCatch(() => {
    copyFileSync(backupPath, transactionLogPath);
  });

  if (isErr(copyResult))
    return fail(
      "restore-failed",
      "Failed to restore backup to transaction log",
      {
        data: { error: copyResult.error },
      },
    );

  for (const fileName of [UNDO_LOG_FILE, DB_FILE, LOCK_FILE]) {
    const filePath = join(dataPath, fileName);
    if (await fs.exists(filePath)) {
      const removeResult = await fs.rm(filePath, { force: true });
      if (isErr(removeResult)) {
        log.warn("Failed to remove file during reset", {
          path: filePath,
          error: removeResult.error,
        });
      }
    }
  }

  const logsDir = join(binderPath, "logs");
  if (await fs.exists(logsDir)) {
    const removeResult = await fs.rm(logsDir, { recursive: true, force: true });
    if (isErr(removeResult)) {
      log.warn("Failed to remove logs directory during reset", {
        path: logsDir,
        error: removeResult.error,
      });
    }
  }

  const repairResult = await repairDbFromLog(ctx);
  if (isErr(repairResult))
    return fail(
      "db-repair-failed",
      "Failed to rebuild database from transaction log",
      { data: { error: repairResult.error } },
    );

  ui.block(() => {
    ui.success("Reset complete");
    ui.list([
      `Restored ${count} transactions from backup`,
      "Database rebuilt successfully",
    ]);
  });

  return okVoid;
};

export const DevCommand = types({
  command: "dev <command>",
  describe: "development utilities",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "backup",
          describe: "create a backup of the transaction log",
          handler: runtimeWithDb(backupHandler),
        }),
      )
      .command(
        types({
          command: "reset",
          describe: "restore from backup and rebuild workspace",
          handler: runtimeWithDb(resetHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: backup, reset");
  },
  handler: async () => {},
});

import { join } from "path";
import { renameSync } from "fs";
import type { Argv } from "yargs";
import {
  createError,
  err,
  getTimestampForFileName,
  isErr,
  ok,
  tryCatch,
} from "@binder/utils";
import { openDb } from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import {
  DB_FILE,
  LOCK_FILE,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
} from "../config.ts";
import { repairDbFromLog } from "../lib/orchestrator.ts";
import { verifyLog } from "../lib/journal.ts";
import { types } from "./types.ts";

export const backupHandler: CommandHandlerWithDb = async ({
  ui,
  kg,
  fs,
  config,
}) => {
  const binderPath = config.paths.binder;
  const transactionLogPath = join(binderPath, TRANSACTION_LOG_FILE);
  const backupPath = join(binderPath, `${TRANSACTION_LOG_FILE}.bac`);

  if (!(await fs.exists(transactionLogPath)))
    return err(
      createError("no-transaction-log", "No transaction log to backup", {
        path: transactionLogPath,
      }),
    );

  const configSchema = kg.getConfigSchema();
  const nodeSchemaResult = await kg.getNodeSchema();
  if (isErr(nodeSchemaResult)) return nodeSchemaResult;

  const verifyResult = await verifyLog(
    fs,
    configSchema,
    nodeSchemaResult.data,
    transactionLogPath,
    {
      verifyIntegrity: false,
    },
  );
  if (isErr(verifyResult)) {
    return err(
      createError(
        "invalid-transaction",
        "Transaction log verification failed: " + verifyResult.error.message,
        verifyResult.data,
      ),
    );
  }

  let renamedBackup: string | null = null;
  if (await fs.exists(backupPath)) {
    const timestampedBackup = join(
      binderPath,
      `${TRANSACTION_LOG_FILE}.${getTimestampForFileName()}.bac`,
    );

    const moveResult = tryCatch(() =>
      renameSync(backupPath, timestampedBackup),
    );
    if (isErr(moveResult))
      return err(
        createError(
          "backup-rename-failed",
          "Failed to rename existing backup",
          { error: moveResult.error },
        ),
      );
    renamedBackup = timestampedBackup;
  }

  const copyResult = await tryCatch(async () => {
    await Bun.write(backupPath, Bun.file(transactionLogPath));
  });

  if (isErr(copyResult))
    return err(
      createError("backup-copy-failed", "Failed to create backup", {
        error: copyResult.error,
      }),
    );

  const items: string[] = [];
  items.push(`Backed up to ${TRANSACTION_LOG_FILE}.bac`);
  if (renamedBackup) {
    items.push(`Previous backup moved to ${renamedBackup.split("/").pop()}`);
  }
  if (!isErr(verifyResult)) {
    items.push(`Verified ${verifyResult.data.count} transactions`);
  }

  ui.block(() => {
    ui.success("Backup created");
    ui.list(items);
  });

  return ok(undefined);
};

export const resetHandler: CommandHandlerWithDb<{ yes?: boolean }> = async ({
  ui,
  kg,
  fs,
  config,
  log,
  args,
}) => {
  const binderPath = config.paths.binder;
  const backupPath = join(binderPath, `${TRANSACTION_LOG_FILE}.bac`);
  const transactionLogPath = join(binderPath, TRANSACTION_LOG_FILE);

  if (!(await fs.exists(backupPath)))
    return err(
      createError(
        "backup-not-found",
        `Backup file ${TRANSACTION_LOG_FILE}.bac is required. Run 'binder dev backup' first.`,
      ),
    );

  const configSchema = kg.getConfigSchema();
  const nodeSchemaResult = await kg.getNodeSchema();
  if (isErr(nodeSchemaResult)) return nodeSchemaResult;

  const verifyResult = await verifyLog(
    fs,
    configSchema,
    nodeSchemaResult.data,
    backupPath,
    {
      verifyIntegrity: true,
    },
  );
  if (isErr(verifyResult))
    return err(
      createError(
        "backup-verification-failed",
        "Backup file verification failed",
        { error: verifyResult.error },
      ),
    );

  const { count } = verifyResult.data;

  if (!args.yes) {
    ui.block(() => {
      ui.warning("About to reset workspace:");
      ui.list([
        `Restore ${count} transactions from backup`,
        `Delete database (${DB_FILE})`,
        `Delete undo log (${UNDO_LOG_FILE})`,
        `Delete logs directory`,
        `Delete lock file (${LOCK_FILE})`,
      ]);
    });

    if (!(await ui.confirm("Proceed with reset? (yes/no): "))) {
      ui.info("Reset cancelled");
      return ok(undefined);
    }
  }

  const copyResult = await tryCatch(async () => {
    await Bun.write(transactionLogPath, Bun.file(backupPath));
  });

  if (isErr(copyResult))
    return err(
      createError(
        "restore-failed",
        "Failed to restore backup to transaction log",
        { error: copyResult.error },
      ),
    );

  const filesToRemove = [UNDO_LOG_FILE, DB_FILE, LOCK_FILE];

  for (const fileName of filesToRemove) {
    const filePath = join(binderPath, fileName);
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

  const dbResult = openDb({ path: join(binderPath, DB_FILE), migrate: true });
  if (isErr(dbResult))
    return err(
      createError("db-open-failed", "Failed to open database after reset", {
        error: dbResult.error,
      }),
    );
  const repairResult = await repairDbFromLog({
    db: dbResult.data as any,
    fs,
    log,
    config,
  });
  if (isErr(repairResult))
    return err(
      createError(
        "db-repair-failed",
        "Failed to rebuild database from transaction log",
        { error: repairResult.error },
      ),
    );

  ui.block(() => {
    ui.success("Reset complete");
    ui.list([
      `Restored ${count} transactions from backup`,
      "Database rebuilt successfully",
    ]);
  });

  return ok(undefined);
};

const DevCommand = types({
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
          builder: (yargs: Argv) => {
            return yargs.option("yes", {
              alias: "y",
              describe: "auto-confirm all prompts",
              type: "boolean",
              default: false,
            });
          },
          handler: runtimeWithDb(resetHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: setup, backup, reset",
      );
  },
  handler: async () => {},
});
export default DevCommand;

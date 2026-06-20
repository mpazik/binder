import { join, sep } from "node:path";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import type { Argv } from "yargs";
import { fail, isErr, okVoid, tryCatch } from "@binder/utils";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";

export const backupHandler: CommandHandlerWithDb = async ({ ui, config }) => {
  const {
    binder: binderPath,
    data: dataPath,
    backups: backupsPath,
  } = config.paths;
  // Snapshot lives outside data/ so cpSync does not reject it as a
  // subdirectory of the source, and so it is never captured in itself.
  const snapshotDir = join(binderPath, "snapshot");

  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });

  const copyResult = tryCatch(() => {
    cpSync(dataPath, snapshotDir, {
      recursive: true,
      filter: (src) =>
        src !== backupsPath && !src.startsWith(backupsPath + sep),
    });
  });

  if (isErr(copyResult))
    return fail("backup-copy-failed", "Failed to create snapshot", {
      data: { error: copyResult.error },
    });

  const entries = readdirSync(snapshotDir);

  ui.block(() => {
    ui.success("Snapshot created");
    ui.list(entries.map((e) => `Captured: ${e}`));
  });

  return okVoid;
};

export const resetHandler: CommandHandlerWithDb = async ({ ui, config }) => {
  const { binder: binderPath, data: dataPath } = config.paths;
  const snapshotDir = join(binderPath, "snapshot");

  if (!existsSync(snapshotDir) || readdirSync(snapshotDir).length === 0)
    return fail(
      "backup-not-found",
      "No snapshot found. Run 'binder dev backup' first.",
    );

  // Remove everything in data/ except the backups subtree.
  for (const entry of readdirSync(dataPath)) {
    if (entry === "backups") continue;
    rmSync(join(dataPath, entry), { recursive: true, force: true });
  }

  const copyResult = tryCatch(() => {
    cpSync(snapshotDir, dataPath, { recursive: true });
  });

  if (isErr(copyResult))
    return fail("restore-failed", "Failed to restore snapshot", {
      data: { error: copyResult.error },
    });

  const entries = readdirSync(snapshotDir);

  ui.block(() => {
    ui.success("Reset complete");
    ui.list(entries.map((e) => `Restored: ${e}`));
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
          describe: "create a snapshot of the data directory",
          handler: runtimeWithDb(backupHandler),
        }),
      )
      .command(
        types({
          command: "reset",
          describe: "restore from snapshot",
          handler: runtimeWithDb(resetHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: backup, reset");
  },
  handler: async () => {},
});

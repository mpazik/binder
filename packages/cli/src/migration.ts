import { join } from "path";
import { isErr, ok, okVoid, type ResultAsync } from "@binder/utils";
import {
  type AppConfig,
  DB_FILE,
  LOCK_FILE,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
} from "./config.ts";
import { type FileSystem } from "./lib/filesystem.ts";
import { type Logger } from "./log.ts";

type MigrationContext = {
  config: AppConfig;
  log: Logger;
  fs: FileSystem;
};

const LEGACY_DATA_FILES = [
  DB_FILE,
  `${DB_FILE}-wal`,
  `${DB_FILE}-shm`,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
  LOCK_FILE,
];

const moveFileIfExists = async (
  fs: FileSystem,
  sourcePath: string,
  targetPath: string,
): ResultAsync<boolean> => {
  if (!(await fs.exists(sourcePath))) return ok(false);
  if (await fs.exists(targetPath)) return ok(false);

  const moveResult = await fs.renameFile(sourcePath, targetPath);
  if (isErr(moveResult)) return moveResult;

  return ok(true);
};

export const migrateLegacyDataLayout = async (
  context: MigrationContext,
): ResultAsync<void> => {
  const {
    fs,
    log,
    config: { paths },
  } = context;

  const dataDirResult = await fs.mkdir(paths.data, { recursive: true });
  if (isErr(dataDirResult)) return dataDirResult;

  const backupsDirResult = await fs.mkdir(paths.backups, { recursive: true });
  if (isErr(backupsDirResult)) return backupsDirResult;

  for (const fileName of LEGACY_DATA_FILES) {
    const sourcePath = join(paths.binder, fileName);
    const targetPath = join(paths.data, fileName);
    const moveResult = await moveFileIfExists(fs, sourcePath, targetPath);
    if (isErr(moveResult)) return moveResult;
    if (moveResult.data) {
      log.info("Migrated workspace data file", { sourcePath, targetPath });
    }
  }

  const entriesResult = await fs.readdir(paths.binder);
  if (isErr(entriesResult)) return entriesResult;

  for (const entry of entriesResult.data) {
    if (!entry.isFile || !entry.name.endsWith(".bac")) continue;

    const sourcePath = join(paths.binder, entry.name);
    const targetPath = join(paths.backups, entry.name);
    const moveResult = await moveFileIfExists(fs, sourcePath, targetPath);
    if (isErr(moveResult)) return moveResult;
    if (moveResult.data) {
      log.info("Migrated workspace backup file", { sourcePath, targetPath });
    }
  }

  const dataEntriesResult = await fs.readdir(paths.data);
  if (isErr(dataEntriesResult)) return dataEntriesResult;

  for (const entry of dataEntriesResult.data) {
    if (!entry.isFile || !entry.name.endsWith(".bac")) continue;

    const sourcePath = join(paths.data, entry.name);
    const targetPath = join(paths.backups, entry.name);
    const moveResult = await moveFileIfExists(fs, sourcePath, targetPath);
    if (isErr(moveResult)) return moveResult;
    if (moveResult.data) {
      log.info("Migrated workspace backup file", { sourcePath, targetPath });
    }
  }

  return okVoid;
};

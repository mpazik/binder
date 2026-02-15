import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  createError,
  isErr,
  ok,
  type Result,
  serializeErrorData,
  tryCatch,
} from "@binder/utils";
import { isBundled } from "../build-time.ts";
import { schema } from "./schema.ts";
import { mergeMigrationFolders } from "./merge-migrations.ts";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseCli = DrizzleDb;

type FileDbOptions = {
  path: string;
  migrate: boolean;
};

type MemoryDbOptions = {
  memory: true;
};

export type OpenCliDbOptions = FileDbOptions | MemoryDbOptions;

export const openCliDb = (
  options: OpenCliDbOptions,
): Result<{
  db: DatabaseCli;
  close: () => void;
}> => {
  const isMemory = "memory" in options && options.memory;
  const dbPath = isMemory ? ":memory:" : (options as FileDbOptions).path;
  const shouldMigrate = isMemory ? true : (options as FileDbOptions).migrate;

  const sqliteResult = tryCatch(
    () => new BunDatabase(dbPath),
    (error) =>
      createError("db-open-failed", `Failed to open database at ${dbPath}`, {
        error,
      }),
  );

  if (isErr(sqliteResult)) return sqliteResult;

  const sqlite = sqliteResult.data;
  const db = drizzle(sqlite, { schema });

  if (shouldMigrate) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    let migrationsPath: string;

    if (isBundled()) {
      // Build step already merged both folders into dist/migrations
      migrationsPath = join(__dirname, "migrations");
    } else {
      // Dev/test: merge on the fly into a temp folder
      const dbMigrationsPath = join(__dirname, "../../../db/src/migrations");
      const cliMigrationsPath = join(__dirname, "migrations");
      migrationsPath = mkdtempSync(join(tmpdir(), "binder-migrations-"));
      mergeMigrationFolders(
        [dbMigrationsPath, cliMigrationsPath],
        migrationsPath,
      );
    }

    const migrationResult = tryCatch(
      () => migrate(db, { migrationsFolder: migrationsPath }),
      (error) =>
        createError("db-migration-failed", "Failed to run migrations", {
          error: serializeErrorData(error),
        }),
    );

    if (isErr(migrationResult)) return migrationResult;
  }

  return ok({ db, close: () => sqlite.close() });
};

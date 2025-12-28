import { fileURLToPath } from "url";
import { dirname, join } from "path";
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

    const dbMigrationsPath = isBundled()
      ? join(__dirname, "migrations-core")
      : join(__dirname, "../../../db/src/migrations");

    const dbMigrationResult = tryCatch(
      () => migrate(db, { migrationsFolder: dbMigrationsPath }),
      (error) =>
        createError("db-migration-failed", "Failed to run core migrations", {
          error: serializeErrorData(error),
        }),
    );

    if (isErr(dbMigrationResult)) return dbMigrationResult;

    const cliMigrationsPath = isBundled()
      ? join(__dirname, "migrations-cli")
      : join(__dirname, "migrations");

    const cliMigrationResult = tryCatch(
      () => migrate(db, { migrationsFolder: cliMigrationsPath }),
      (error) =>
        createError("cli-migration-failed", "Failed to run CLI migrations", {
          error: serializeErrorData(error),
        }),
    );

    if (isErr(cliMigrationResult)) return cliMigrationResult;
  }

  return ok({ db, close: () => sqlite.close() });
};

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core";
import {
  createError,
  type Result,
  ok,
  isErr,
  tryCatch,
  serializeErrorData,
} from "@binder/utils";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DbTransaction = SQLiteTransaction<any, any, any, any>;

type FileDbOptions = {
  path: string;
  migrate: boolean;
};

type MemoryDbOptions = {
  memory: true;
};

export type OpenDbOptions = FileDbOptions | MemoryDbOptions;

export const openDb = (options: OpenDbOptions): Result<Database> => {
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

  const db = drizzle(sqliteResult.data, { schema });

  if (shouldMigrate) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationsPath = join(__dirname, "migrations");

    const migrationResult = tryCatch(
      () => migrate(db, { migrationsFolder: migrationsPath }),
      (error) =>
        createError("db-migration-failed", "Failed to run migrations", {
          error: serializeErrorData(error),
        }),
    );

    if (isErr(migrationResult)) return migrationResult;
  }

  return ok(db);
};

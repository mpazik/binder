import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core";
import { createError, type Result, ok, isErr, tryCatch } from "@binder/utils";
import { Database as SqliteDatabase, drizzle, migrate } from "./sqlite.bun.ts";
import * as coreSchema from "./schema";

type DbSchema = Record<string, unknown>;

type CustomMigrationResult = Result<void> | void;

export type DrizzleDb<TSchema extends DbSchema = typeof coreSchema> =
  ReturnType<typeof drizzle<TSchema>> & {
    $client: InstanceType<typeof SqliteDatabase>;
  };

export type Database = DrizzleDb<typeof coreSchema>;
export type DbTransaction = SQLiteTransaction<any, any, any, any>;

export type OpenDbMigrationContext<TSchema extends DbSchema> = {
  db: DrizzleDb<TSchema>;
  sqlite: InstanceType<typeof SqliteDatabase>;
  defaultMigrationsFolder: string;
  migrateDefault: (migrationsFolder?: string) => Result<void>;
};

export type OpenDbMigrationOptions<TSchema extends DbSchema> = {
  folder?: string;
  run?: (context: OpenDbMigrationContext<TSchema>) => CustomMigrationResult;
};

type FileDbOptions<TSchema extends DbSchema> = {
  path: string;
  migrate: boolean | OpenDbMigrationOptions<TSchema>;
  schema?: TSchema;
};

type MemoryDbOptions<TSchema extends DbSchema> = {
  memory: true;
  migrate?: boolean | OpenDbMigrationOptions<TSchema>;
  schema?: TSchema;
};

export type OpenDbOptions<TSchema extends DbSchema = typeof coreSchema> =
  | FileDbOptions<TSchema>
  | MemoryDbOptions<TSchema>;

/**
 * Patch transaction() to tolerate async callbacks.
 *
 * The knowledge-graph transaction callbacks are `async (tx) => { ... }`.
 * All Drizzle SQLite operations inside resolve synchronously, so the async
 * is effectively a no-op. But better-sqlite3 explicitly throws when a
 * transaction callback returns a Promise. This wrapper captures the return
 * value before better-sqlite3 sees it.
 *
 * Under Bun (bun:sqlite) the patch is harmless -- it just adds an extra
 * indirection layer that doesn't change behavior.
 */
const patchTransactionForAsyncCompat = (
  db: InstanceType<typeof SqliteDatabase>,
): void => {
  const origTransaction = db.transaction.bind(db);

  db.transaction = ((fn: (...args: any[]) => any) => {
    let capturedResult: any;
    // typed as `any` because bun:sqlite and better-sqlite3 expose different
    // transaction method shapes (.default exists only in better-sqlite3)
    const wrapped: any = origTransaction((...args: any[]) => {
      capturedResult = fn(...args);
    });

    const patched = Object.assign(
      (...args: any[]) => {
        wrapped(...args);
        return capturedResult;
      },
      {
        default: (...args: any[]) => {
          wrapped.default(...args);
          return capturedResult;
        },
        deferred: (...args: any[]) => {
          wrapped.deferred(...args);
          return capturedResult;
        },
        immediate: (...args: any[]) => {
          wrapped.immediate(...args);
          return capturedResult;
        },
        exclusive: (...args: any[]) => {
          wrapped.exclusive(...args);
          return capturedResult;
        },
      },
    );

    return patched;
  }) as typeof db.transaction;
};

const applyBalancedSqlitePragmas = (
  sqlite: InstanceType<typeof SqliteDatabase>,
): Result<void> =>
  tryCatch(
    () => {
      sqlite.exec(`
        -- Integrity and lock behavior
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;

        -- Balanced durability and concurrency for local-first workloads
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        -- Modest memory tuning
        PRAGMA cache_size = -16384;   -- ~16 MiB (default is commonly 2000 pages)
        PRAGMA mmap_size = 67108864;  -- up to 64 MiB (default is 0 / disabled)
      `);
    },
    (error) =>
      createError("db-config-failed", "Failed to apply SQLite configuration", {
        data: error instanceof Error ? { stack: error.stack } : undefined,
      }),
  );

export const openDb = <TSchema extends DbSchema = typeof coreSchema>(
  options: OpenDbOptions<TSchema>,
): Result<DrizzleDb<TSchema>> => {
  const isMemory = "memory" in options && options.memory;
  const dbPath = isMemory
    ? ":memory:"
    : (options as FileDbOptions<TSchema>).path;
  const migrateOption = options.migrate;
  const shouldMigrate =
    migrateOption === undefined ? isMemory : migrateOption !== false;

  const sqliteResult = tryCatch(
    () => new SqliteDatabase(dbPath),
    (error) =>
      createError("db-open-failed", `Failed to open database at ${dbPath}`, {
        data: error instanceof Error ? { stack: error.stack } : undefined,
      }),
  );

  if (isErr(sqliteResult)) return sqliteResult;

  const sqlite = sqliteResult.data;
  patchTransactionForAsyncCompat(sqlite);

  const pragmaResult = applyBalancedSqlitePragmas(sqlite);
  if (isErr(pragmaResult)) {
    sqlite.close();
    return pragmaResult;
  }

  const dbSchema = (options.schema ?? coreSchema) as TSchema;
  const db = drizzle<TSchema>(sqlite, {
    schema: dbSchema,
  }) as DrizzleDb<TSchema>;

  if (shouldMigrate) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const defaultMigrationsFolder = join(__dirname, "migrations");

    const customMigrateOption =
      typeof migrateOption === "object" ? migrateOption : undefined;

    const migrateDefault = (
      migrationsFolder = customMigrateOption?.folder ?? defaultMigrationsFolder,
    ): Result<void> =>
      tryCatch(
        () => migrate(db, { migrationsFolder }),
        (error) =>
          createError("db-migration-failed", "Failed to run migrations", {
            data: error instanceof Error ? { stack: error.stack } : undefined,
          }),
      );

    const customMigrationRunner = customMigrateOption?.run;

    if (customMigrationRunner) {
      const customRunnerResult = tryCatch(
        () =>
          customMigrationRunner({
            db,
            sqlite,
            defaultMigrationsFolder,
            migrateDefault,
          }),
        (error) =>
          createError(
            "db-migration-failed",
            "Failed to run custom migration logic",
            {
              data: error instanceof Error ? { stack: error.stack } : undefined,
            },
          ),
      );

      if (isErr(customRunnerResult)) {
        sqlite.close();
        return customRunnerResult;
      }

      const customMigrationResult = customRunnerResult.data;
      if (customMigrationResult && isErr(customMigrationResult)) {
        sqlite.close();
        return customMigrationResult;
      }
    } else {
      const migrationResult = migrateDefault();
      if (isErr(migrationResult)) {
        sqlite.close();
        return migrationResult;
      }
    }
  }

  return ok(db);
};

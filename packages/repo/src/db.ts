import { AsyncLocalStorage } from "node:async_hooks";
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
  /** Open SQLite in read-only mode. Incompatible with migrations. */
  readonly?: boolean;
};

type MemoryDbOptions<TSchema extends DbSchema> = {
  memory: true;
  migrate?: boolean | OpenDbMigrationOptions<TSchema>;
  schema?: TSchema;
};

export type OpenDbOptions<TSchema extends DbSchema = typeof coreSchema> =
  | FileDbOptions<TSchema>
  | MemoryDbOptions<TSchema>;

type TransactionBehavior = "deferred" | "immediate" | "exclusive";

type AsyncTransactionContext = {
  active: boolean;
  nextSavepoint: number;
};

const isErrResult = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "error" in value &&
  value.error !== undefined;

const rollbackIgnoringFailure = (
  sqlite: InstanceType<typeof SqliteDatabase>,
  statement: string,
): void => {
  void tryCatch(() => sqlite.exec(statement));
};

/**
 * Keep explicit SQLite transactions open until async callbacks settle.
 * Operations on one connection are queued, with savepoints for nested calls.
 */
const patchTransactionForAsyncCompat = <TSchema extends DbSchema>(
  db: DrizzleDb<TSchema>,
  sqlite: InstanceType<typeof SqliteDatabase>,
): void => {
  const originalTransaction = db.transaction.bind(db);
  const transactionHandle = originalTransaction((tx) => tx);
  const contextStorage = new AsyncLocalStorage<AsyncTransactionContext>();
  let queueTail: Promise<void> = Promise.resolve();

  const runNested = <T>(
    fn: (tx: typeof transactionHandle) => T | Promise<T>,
    context: AsyncTransactionContext,
  ): Promise<T> => {
    const savepoint = `binder_async_${context.nextSavepoint++}`;
    sqlite.exec(`SAVEPOINT ${savepoint}`);

    return Promise.resolve()
      .then(() => fn(transactionHandle))
      .then((result) => {
        if (isErrResult(result))
          sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      })
      .catch((error) => {
        rollbackIgnoringFailure(sqlite, `ROLLBACK TO SAVEPOINT ${savepoint}`);
        rollbackIgnoringFailure(sqlite, `RELEASE SAVEPOINT ${savepoint}`);
        return Promise.reject(error);
      });
  };

  const runTopLevel = <T>(
    fn: (tx: typeof transactionHandle) => T | Promise<T>,
    behavior: TransactionBehavior,
  ): Promise<T> => {
    sqlite.exec(`BEGIN ${behavior.toUpperCase()}`);
    const context: AsyncTransactionContext = {
      active: true,
      nextSavepoint: 0,
    };

    return contextStorage.run(context, () =>
      Promise.resolve()
        .then(() => fn(transactionHandle))
        .then((result) => {
          sqlite.exec(isErrResult(result) ? "ROLLBACK" : "COMMIT");
          return result;
        })
        .catch((error) => {
          rollbackIgnoringFailure(sqlite, "ROLLBACK");
          return Promise.reject(error);
        })
        .finally(() => {
          context.active = false;
        }),
    );
  };

  db.transaction = ((
    fn: (tx: typeof transactionHandle) => unknown,
    config?: { behavior?: TransactionBehavior },
  ) => {
    const context = contextStorage.getStore();
    if (context?.active) return runNested(fn, context);

    const behavior = config?.behavior ?? "deferred";
    const run = queueTail.then(() => runTopLevel(fn, behavior));
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
  const isReadonly =
    !isMemory && (options as FileDbOptions<TSchema>).readonly === true;
  // readonly connection can't migrate.
  const shouldMigrate = isReadonly
    ? false
    : migrateOption === undefined
      ? isMemory
      : migrateOption !== false;

  const sqliteResult = tryCatch(
    () =>
      isReadonly
        ? new SqliteDatabase(dbPath, { readonly: true } as never)
        : new SqliteDatabase(dbPath),
    (error) =>
      createError("db-open-failed", `Failed to open database at ${dbPath}`, {
        data: error instanceof Error ? { stack: error.stack } : undefined,
      }),
  );

  if (isErr(sqliteResult)) return sqliteResult;

  const sqlite = sqliteResult.data;

  // Pragmas that write (journal_mode=WAL, foreign_keys) fail on readonly
  // connections. Skip pragma setup entirely; readonly callers don't need
  // WAL tuning.
  if (!isReadonly) {
    const pragmaResult = applyBalancedSqlitePragmas(sqlite);
    if (isErr(pragmaResult)) {
      sqlite.close();
      return pragmaResult;
    }
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

  patchTransactionForAsyncCompat(db, sqlite);

  return ok(db);
};

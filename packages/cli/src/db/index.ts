import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { openDb } from "@binder/repo";
import { isErr, ok, type Result } from "@binder/utils";
import { isBundled } from "../environment.ts";
import { schema } from "./schema.ts";
import { mergeMigrationFolders } from "./merge-migrations.ts";

export type DatabaseCli =
  ReturnType<typeof openDb<typeof schema>> extends Result<infer T> ? T : never;

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

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const dbResult = openDb({
    ...(isMemory ? { memory: true as const } : { path: dbPath }),
    schema,
    migrate: shouldMigrate
      ? {
          run: ({ defaultMigrationsFolder, migrateDefault }) => {
            let migrationsPath: string;

            if (isBundled()) {
              // Build step already merged both folders into dist/migrations
              migrationsPath = join(__dirname, "migrations");
            } else {
              // Dev/test: merge core + CLI migrations on the fly into a temp folder
              const cliMigrationsPath = join(__dirname, "migrations");
              migrationsPath = mkdtempSync(
                join(tmpdir(), "binder-migrations-"),
              );
              mergeMigrationFolders(
                [defaultMigrationsFolder, cliMigrationsPath],
                migrationsPath,
              );
            }

            return migrateDefault(migrationsPath);
          },
        }
      : false,
  });

  if (isErr(dbResult)) return dbResult;

  const db = dbResult.data;
  return ok({ db, close: () => db.$client.close() });
};

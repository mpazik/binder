import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import type { DrizzleDb, OpenDbMigrationOptions } from "@binder/repo";
import { openDb } from "@binder/repo";
import { isErr, ok, type Result } from "@binder/utils";
import { isBundled } from "../environment.ts";
import { schema } from "./schema.ts";
import { mergeMigrationFolders } from "./merge-migrations.ts";

export { schema as cliSchema };

export type DatabaseCli = DrizzleDb<typeof schema>;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Merges core + CLI migration folders and runs via the default Drizzle migrate helper. */
export const cliMigrationRunner: NonNullable<
  OpenDbMigrationOptions<typeof schema>["run"]
> = ({ defaultMigrationsFolder, migrateDefault }) => {
  const cliMigrationsPath = join(__dirname, "migrations");

  if (isBundled()) return migrateDefault(cliMigrationsPath);

  // Dev/test: merge core + CLI migrations on the fly into a temp folder
  const mergedPath = mkdtempSync(join(tmpdir(), "binder-migrations-"));
  mergeMigrationFolders(
    [defaultMigrationsFolder, cliMigrationsPath],
    mergedPath,
  );
  return migrateDefault(mergedPath);
};

/** Open an in-memory CLI database with merged migrations. Used by tests. */
export const openMemoryCliDb = (): Result<{
  db: DatabaseCli;
  close: () => void;
}> => {
  const dbResult = openDb({
    memory: true as const,
    schema,
    migrate: { run: cliMigrationRunner },
  });
  if (isErr(dbResult)) return dbResult;
  return ok({
    db: dbResult.data,
    close: () => dbResult.data.$client.close(),
  });
};

import { mkdirSync, cpSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

/**
 * Merges multiple Drizzle migration folders into a single folder.
 *
 * Drizzle's migrator requires all migrations for a database to live in one
 * folder with one `_journal.json`. When migrations come from multiple sources
 * (e.g. a library and a consuming app), they must be merged before running
 * `migrate()`.
 *
 * This function:
 * 1. Copies all `.sql` files from each source folder into the target
 * 2. Merges the `_journal.json` entries, sorted by timestamp
 * 3. Re-indexes entries sequentially
 *
 * Snapshot files (`meta/*.json`) are not copied — they are only needed by
 * `drizzle-kit generate`, not by the runtime migrator.
 */
export const mergeMigrationFolders = (
  sourceFolders: string[],
  targetFolder: string,
): void => {
  mkdirSync(join(targetFolder, "meta"), { recursive: true });

  const allEntries: JournalEntry[] = [];
  let journal: Pick<Journal, "version" | "dialect"> | undefined;

  for (const source of sourceFolders) {
    const journalPath = join(source, "meta", "_journal.json");
    const raw: Journal = JSON.parse(readFileSync(journalPath, "utf-8"));

    if (!journal) {
      journal = { version: raw.version, dialect: raw.dialect };
    }

    for (const entry of raw.entries) {
      cpSync(
        join(source, `${entry.tag}.sql`),
        join(targetFolder, `${entry.tag}.sql`),
      );
      allEntries.push(entry);
    }
  }

  allEntries.sort((a, b) => a.when - b.when);

  const merged: Journal = {
    version: journal!.version,
    dialect: journal!.dialect,
    entries: allEntries.map((entry, idx) => ({ ...entry, idx })),
  };

  writeFileSync(
    join(targetFolder, "meta", "_journal.json"),
    JSON.stringify(merged, null, 2),
  );
};

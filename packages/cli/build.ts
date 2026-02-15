#!/usr/bin/env bun
/* eslint-disable no-console */
import { readFileSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const isProd = process.argv.includes("--prod");

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "package.json"), "utf-8"),
);
const baseVersion = packageJson.version;

const version = isProd
  ? baseVersion
  : `${baseVersion}-dev.${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "")}`;

console.log(
  `Building Binder CLI v${version}${isProd ? " (production)" : " (development)"}...`,
);

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "bundle",
  define: {
    __BINDER_VERSION__: JSON.stringify(version),
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`✓ Built successfully: dist/index.js`);

const { mergeMigrationFolders } = await import("./src/db/merge-migrations.ts");

const dbMigrationsSource = join(import.meta.dir, "../db/src/migrations");
const cliMigrationsSource = join(import.meta.dir, "src/db/migrations");
const migrationsTarget = join(import.meta.dir, "dist/migrations");

mergeMigrationFolders(
  [dbMigrationsSource, cliMigrationsSource],
  migrationsTarget,
);

console.log(`✓ Merged migrations to dist/migrations`);

const blueprintsSource = join(import.meta.dir, "data/blueprints");
const blueprintsTarget = join(import.meta.dir, "dist/blueprints");

mkdirSync(blueprintsTarget, { recursive: true });
cpSync(blueprintsSource, blueprintsTarget, { recursive: true });

console.log(`✓ Copied blueprints to dist/blueprints`);

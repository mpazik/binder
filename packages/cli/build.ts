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

const migrationsSource = join(import.meta.dir, "../db/src/migrations");
const migrationsTarget = join(import.meta.dir, "dist/migrations");

mkdirSync(migrationsTarget, { recursive: true });
cpSync(migrationsSource, migrationsTarget, { recursive: true });

console.log(`✓ Copied migrations to dist/migrations`);

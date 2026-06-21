#!/usr/bin/env bun
/* eslint-disable no-console */
import { readFileSync, cpSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import type { BunPlugin } from "bun";

const isProd = process.argv.includes("--prod");
const isLocal = process.argv.includes("--local");

const DEFAULT_TELEMETRY_KEY =
  "phc_skSi2u7J7SVkYXs2NeqvXugUFKtvZeP2NGcaKmNCRHkv";
const DEFAULT_TELEMETRY_HOST = "https://us.i.posthog.com";

const telemetryKey = process.env.BINDER_TELEMETRY_KEY ?? DEFAULT_TELEMETRY_KEY;
const telemetryHost =
  process.env.BINDER_TELEMETRY_HOST ?? DEFAULT_TELEMETRY_HOST;

const defineLiteral = (value: string | undefined): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "package.json"), "utf-8"),
);
const baseVersion = packageJson.version;

const version = isProd
  ? isLocal
    ? `${baseVersion}-local.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
    : baseVersion
  : `${baseVersion}-dev.${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "")}`;

console.log(
  `Building Binder CLI v${version}${isProd ? " (production)" : " (development)"}...`,
);

/** Swaps *.bun.ts imports for *.node.ts counterparts in the production Node build. */
const nodeCompatPlugin: BunPlugin = {
  name: "node-compat",
  setup(build) {
    build.onResolve({ filter: /\.bun(\.ts)?$/ }, (args) => {
      const nodeVersion = args.path.replace(/\.bun(\.ts)?$/, ".node.ts");
      return {
        path: resolve(dirname(args.importer), nodeVersion),
      };
    });
  },
};

const result = await Bun.build({
  // workspace.ts is a separate entrypoint so importing it never runs the CLI
  // (index.ts runs yargs as a top-level side effect on import).
  // NOTE: index.js and workspace.js will duplicate shared code until code
  // splitting is enabled (accepted; follow-up task).
  entrypoints: [
    "./src/index.ts",
    "./src/telemetry-flush.ts",
    "./src/workspace.ts",
  ],
  outdir: "./dist",
  target: "node",
  packages: "bundle",
  external: ["better-sqlite3"],
  define: {
    __BINDER_VERSION__: JSON.stringify(version),
    __BINDER_TELEMETRY_KEY__: defineLiteral(telemetryKey),
    __BINDER_TELEMETRY_HOST__: defineLiteral(telemetryHost),
  },
  plugins: [nodeCompatPlugin],
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

const dbMigrationsSource = join(import.meta.dir, "../repo/src/migrations");
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

const publicSource = join(import.meta.dir, "src/http/public");
const publicTarget = join(import.meta.dir, "dist/public");

mkdirSync(publicTarget, { recursive: true });
cpSync(publicSource, publicTarget, { recursive: true });

console.log(`✓ Copied public dir to dist/public`);

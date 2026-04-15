import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import {
  DB_FILE,
  LOCK_FILE,
  TRANSACTION_LOG_FILE,
  UNDO_LOG_FILE,
  type AppConfig,
} from "./config.ts";
import { migrateLegacyDataLayout } from "./migration.ts";
import type { RuntimeContext } from "./runtime.ts";
import { mockLog, mockTelemetry, mockUi } from "./runtime.mock.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";

describe("migrateLegacyDataLayout", () => {
  const fs = createInMemoryFileSystem();
  const root = "/workspace";
  const binder = `${root}/.binder`;

  const config: AppConfig = {
    author: "test-user",
    paths: {
      root,
      binder,
      data: `${binder}/data`,
      backups: `${binder}/data/backups`,
      docs: `${root}/docs`,
    },
  };

  const context: RuntimeContext = {
    config,
    telemetry: mockTelemetry,
    fs,
    log: mockLog,
    ui: mockUi,
  };

  beforeEach(async () => {
    throwIfError(await fs.rm(root, { recursive: true, force: true }));
    throwIfError(await fs.mkdir(root));
    throwIfError(await fs.mkdir(binder));
  });

  it("creates data and backup directories", async () => {
    const result = await migrateLegacyDataLayout(context);
    expect(result).toBeOk();

    expect(await fs.exists(config.paths.data)).toBe(true);
    expect(await fs.exists(config.paths.backups)).toBe(true);
  });

  it("moves legacy data files into .binder/data", async () => {
    const legacyFiles = [
      DB_FILE,
      `${DB_FILE}-wal`,
      `${DB_FILE}-shm`,
      TRANSACTION_LOG_FILE,
      UNDO_LOG_FILE,
      LOCK_FILE,
    ];

    for (const file of legacyFiles) {
      throwIfError(await fs.writeFile(`${binder}/${file}`, file));
    }

    throwIfError(await fs.writeFile(`${binder}/transactions.jsonl.bac`, "bac"));
    throwIfError(await fs.mkdir(config.paths.data, { recursive: true }));
    throwIfError(
      await fs.writeFile(`${config.paths.data}/repair.jsonl.bac`, "bac"),
    );

    const result = await migrateLegacyDataLayout(context);
    expect(result).toBeOk();

    for (const file of legacyFiles) {
      expect(await fs.exists(`${binder}/${file}`)).toBe(false);
      expect(await fs.exists(`${config.paths.data}/${file}`)).toBe(true);
    }

    expect(await fs.exists(`${binder}/transactions.jsonl.bac`)).toBe(false);
    expect(
      await fs.exists(`${config.paths.backups}/transactions.jsonl.bac`),
    ).toBe(true);
    expect(await fs.exists(`${config.paths.data}/repair.jsonl.bac`)).toBe(
      false,
    );
    expect(await fs.exists(`${config.paths.backups}/repair.jsonl.bac`)).toBe(
      true,
    );
  });
});

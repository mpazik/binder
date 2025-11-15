import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import { LOCK_FILE } from "../config.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";

const ROOT_DIR = join(import.meta.dir, "/root");
const LOCK_PATH = join(ROOT_DIR, LOCK_FILE);

describe("workspace lock", () => {
  const fs = createInMemoryFileSystem();

  beforeEach(async () => {
    await fs.rm(ROOT_DIR, { recursive: true, force: true });
    await fs.mkdir(ROOT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(ROOT_DIR, { recursive: true, force: true });
  });

  it("acquires and releases lock successfully", async () => {
    const lockResult = await acquireLock(fs, ROOT_DIR);
    expect(lockResult).toBeOk();

    expect(await fs.exists(LOCK_PATH)).toBe(true);

    expect(await releaseLock(fs, ROOT_DIR)).toBeOk();
    expect(await fs.exists(LOCK_PATH)).toBe(false);
  });

  it("fails to acquire lock when already held", async () => {
    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();

    expect(await acquireLock(fs, ROOT_DIR)).toBeErr();
  });

  it("can acquire lock after release", async () => {
    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();

    expect(await releaseLock(fs, ROOT_DIR)).toBeOk();

    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();
  });

  it("stores pid and timestamp in lock file", async () => {
    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();

    const content = throwIfError(await fs.readFile(LOCK_PATH));
    expect(JSON.parse(content)).toEqual({
      pid: process.pid,
      timestamp: expect.any(Number),
    });
  });

  it("handles multiple release calls gracefully", async () => {
    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();

    expect(await releaseLock(fs, ROOT_DIR)).toBeOk();
    expect(await releaseLock(fs, ROOT_DIR)).toBeOk();
    expect(await releaseLock(fs, ROOT_DIR)).toBeOk();
  });

  it("cleans lock from dead process", async () => {
    const staleLockData = {
      pid: 999999,
      timestamp: Date.now(),
    };
    await fs.writeFile(LOCK_PATH, JSON.stringify(staleLockData));

    expect(await acquireLock(fs, ROOT_DIR)).toBeOk();
    expect(await fs.exists(LOCK_PATH)).toBe(true);
  });
});

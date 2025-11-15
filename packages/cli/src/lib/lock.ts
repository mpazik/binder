import { join } from "path";
import {
  createError,
  err,
  isErr,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { LOCK_FILE, LOCK_MAX_RETRIES, LOCK_RETRY_DELAY_MS } from "../config.ts";
import type { FileSystem } from "./filesystem.ts";

type LockData = {
  pid: number;
  timestamp: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isProcessRunning = (pid: number): boolean => {
  const result = tryCatch(() => {
    process.kill(pid, 0); // it is not a real kill, just check if process is running
    return true;
  });
  return !isErr(result);
};

const isLockStale = async (
  fs: FileSystem,
  lockPath: string,
): Promise<boolean> => {
  const readResult = await fs.readFile(lockPath);
  if (isErr(readResult)) return true;

  const parseResult = tryCatch(() => {
    const data = JSON.parse(readResult.data) as LockData;
    return !isProcessRunning(data.pid);
  });

  if (isErr(parseResult)) return true;
  return parseResult.data;
};

const tryAcquireLock = async (
  fs: FileSystem,
  lockPath: string,
): ResultAsync<void> => {
  const exists = await fs.exists(lockPath);
  if (exists) {
    return err(
      createError("lock-exists", "Lock file already exists", {
        path: lockPath,
      }),
    );
  }

  const content = JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
  });

  return fs.writeFile(lockPath, content);
};

export const acquireLock = async (
  fs: FileSystem,
  root: string,
): Promise<Result<void>> => {
  const lockPath = join(root, LOCK_FILE);

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    const lockResult = await tryAcquireLock(fs, lockPath);
    if (!isErr(lockResult)) return lockResult;

    const stale = await isLockStale(fs, lockPath);
    if (stale) {
      const cleanResult = await fs.rm(lockPath, { force: true });
      if (isErr(cleanResult)) {
        return err(
          createError(
            "lock-cleanup-failed",
            "Failed to clean stale lock file",
            { path: lockPath, error: cleanResult.error },
          ),
        );
      }
      continue;
    }

    if (attempt < LOCK_MAX_RETRIES - 1) {
      await sleep(LOCK_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return err(
    createError(
      "lock-acquire-failed",
      `Another Binder process is running. Failed to acquire lock after ${LOCK_MAX_RETRIES} attempts.`,
      { path: lockPath },
    ),
  );
};

export const withLock = async <T>(
  fs: FileSystem,
  root: string,
  operation: () => ResultAsync<T>,
): ResultAsync<T> => {
  const lockResult = await acquireLock(fs, root);
  if (isErr(lockResult)) return lockResult;

  const result = await operation();
  const releaseResult = await releaseLock(fs, root);
  if (isErr(releaseResult)) return releaseResult;
  return result;
};

export const releaseLock = async (
  fs: FileSystem,
  root: string,
): ResultAsync<void> => {
  const lockPath = join(root, LOCK_FILE);
  const unlinkResult = await fs.rm(lockPath, { force: true });

  if (isErr(unlinkResult))
    return err(
      createError("lock-release-failed", "Failed to remove lock file", {
        path: lockPath,
        error: unlinkResult.error,
      }),
    );

  return ok(undefined);
};

export const setupCleanupHandlers = (fs: FileSystem, root: string): void => {
  process.on("SIGINT", () => {
    releaseLock(fs, root)
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        process.exit(130);
      });
  });

  process.on("SIGTERM", () => {
    releaseLock(fs, root)
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        process.exit(143);
      });
  });
};

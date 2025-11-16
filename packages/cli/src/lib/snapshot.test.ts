import { beforeEach, describe, expect, it } from "bun:test";
import { newIsoTimestamp, throwIfError } from "@binder/utils";
import {
  type GraphVersion,
  type TransactionId,
  versionFromTransaction,
} from "@binder/db";
import { mockTransactionInit } from "@binder/db/mocks";
import { getTestDatabaseCli } from "../db/db.mock.ts";
import type { DatabaseCli } from "../db";
import { mockConfig } from "../bootstrap.mock.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";
import { type FileSystem } from "./filesystem.ts";
import {
  calculateFileHash,
  getSnapshotMetadata,
  modifiedFiles,
  saveSnapshot,
  saveSnapshotMetadata,
} from "./snapshot.ts";

const rootPath = mockConfig.paths.docs;
const filePath = `${rootPath}/test.md`;
const filePath2 = `${rootPath}/test2.md`;

const version: GraphVersion = versionFromTransaction(mockTransactionInit);

describe("snapshot", () => {
  let fs: FileSystem;
  let db: DatabaseCli;

  beforeEach(async () => {
    fs = createInMemoryFileSystem();
    await fs.mkdir(rootPath, { recursive: true });
    db = getTestDatabaseCli();
  });

  describe("calculateFileHash", () => {
    it("calculates SHA-256 hash of file content", async () => {
      await fs.writeFile(filePath, "hello world");
      const hash = await calculateFileHash(fs, filePath);
      expect(hash).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("returns consistent hash for same file content", async () => {
      await fs.writeFile(filePath, "test content");
      await fs.writeFile(filePath2, "test content");
      const hash1 = await calculateFileHash(fs, filePath);
      const hash2 = await calculateFileHash(fs, filePath2);
      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different file content", async () => {
      await fs.writeFile(filePath, "content one");
      await fs.writeFile(filePath2, "content two");
      const hash1 = await calculateFileHash(fs, filePath);
      const hash2 = await calculateFileHash(fs, filePath2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("saveSnapshot", () => {
    const content = "# Test Document\n\nThis is a test.";

    it("saves file to filesystem and creates corresponding metadata record", async () => {
      throwIfError(await saveSnapshot(db, fs, filePath, content, version));

      expect((await fs.readFile(filePath)).data).toBe(content);

      const metadata = throwIfError(getSnapshotMetadata(db));
      expect(metadata).toEqual([
        {
          id: 1,
          path: filePath,
          txId: version.id,
          ...throwIfError(fs.stat(filePath)),
          hash: await calculateFileHash(fs, filePath),
        },
      ]);
    });

    it("updates same file with new transaction replaces metadata", async () => {
      const version2: GraphVersion = {
        id: 2 as TransactionId,
        hash: "hash2" as any,
        updatedAt: newIsoTimestamp(),
      };

      throwIfError(await saveSnapshot(db, fs, filePath, content, version));
      throwIfError(await saveSnapshot(db, fs, filePath, "Version 2", version2));

      const fileResult = await fs.readFile(filePath);
      expect(fileResult.data).toBe("Version 2");

      const metadata = throwIfError(getSnapshotMetadata(db));
      expect(metadata).toEqual([
        {
          id: 1,
          path: filePath,
          txId: version2.id,
          ...throwIfError(fs.stat(filePath)),
          hash: await calculateFileHash(fs, filePath),
        },
      ]);
    });
  });

  describe("modifiedFiles", () => {
    it("detects new untracked file", async () => {
      await fs.writeFile(filePath, "new content");

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toEqual([{ type: "untracked", path: filePath }]);
    });

    it("ignores unchanged files", async () => {
      await saveSnapshot(db, fs, filePath, "unchanged content", version);

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toEqual([]);
    });

    it("detects updated file with newer mtime", async () => {
      await fs.writeFile(filePath, "original");

      const originalStat = throwIfError(fs.stat(filePath));

      await saveSnapshotMetadata(db, [
        {
          path: filePath,
          txId: version.id,
          mtime: originalStat.mtime - 1000,
          size: originalStat.size,
          hash: await calculateFileHash(fs, filePath),
        },
      ]);
      await fs.writeFile(filePath, "updated content");

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toEqual([
        { type: "updated", path: filePath, txId: version.id },
      ]);
    });

    it("detects outdated file with older mtime", async () => {
      await fs.writeFile(filePath, "current content");

      const currentStat = throwIfError(fs.stat(filePath));

      await saveSnapshotMetadata(db, [
        {
          path: filePath,
          txId: version.id,
          mtime: currentStat.mtime + 1000,
          size: currentStat.size + 10,
          hash: "different-hash-value",
        },
      ]);

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toEqual([
        { type: "outdated", path: filePath, txId: version.id },
      ]);
    });

    it("detects removed file", async () => {
      await saveSnapshotMetadata(db, [
        {
          path: filePath,
          txId: version.id,
          mtime: Date.now(),
          size: 100,
          hash: "some-hash",
        },
      ]);

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toEqual([
        { type: "removed", path: filePath, txId: version.id },
      ]);
    });

    it("handles multiple files with different change types", async () => {
      const untracedPath = `${rootPath}/untracked.md`;
      await fs.writeFile(untracedPath, "new content");

      const updatedPath = `${rootPath}/updated.md`;
      await fs.writeFile(updatedPath, "original");
      const updatedStat = throwIfError(fs.stat(updatedPath));
      const removedPath = `${rootPath}/removed.md`;

      await saveSnapshotMetadata(db, [
        {
          path: updatedPath,
          txId: 2 as TransactionId,
          mtime: updatedStat.mtime - 1000,
          size: updatedStat.size,
          hash: await calculateFileHash(fs, updatedPath),
        },
        {
          path: removedPath,
          txId: 3 as TransactionId,
          mtime: Date.now(),
          size: 50,
          hash: "removed-hash",
        },
      ]);
      await fs.writeFile(updatedPath, "modified content");

      const result = throwIfError(await modifiedFiles(db, fs, rootPath));

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({
        type: "untracked",
        path: untracedPath,
      });
      expect(result).toContainEqual({
        type: "updated",
        path: updatedPath,
        txId: 2 as TransactionId,
      });
      expect(result).toContainEqual({
        type: "removed",
        path: removedPath,
        txId: 3 as TransactionId,
      });
    });
  });
});

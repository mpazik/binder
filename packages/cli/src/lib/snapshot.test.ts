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

const paths = mockConfig.paths;
const { docs: docsPath } = paths;
const filePath = `${docsPath}/test.md`;
const filePath2 = `${docsPath}/test2.md`;

const version: GraphVersion = versionFromTransaction(mockTransactionInit);

describe("snapshot", () => {
  let fs: FileSystem;
  let db: DatabaseCli;

  beforeEach(async () => {
    fs = createInMemoryFileSystem();
    await fs.mkdir(docsPath, { recursive: true });
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
      throwIfError(
        await saveSnapshot(db, fs, paths, filePath, content, version, "node"),
      );

      expect((await fs.readFile(filePath)).data).toBe(content);

      const metadata = throwIfError(getSnapshotMetadata(db));
      expect(metadata).toEqual([
        {
          id: 1,
          path: "test.md",
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

      throwIfError(
        await saveSnapshot(db, fs, paths, filePath, content, version),
      );
      throwIfError(
        await saveSnapshot(db, fs, paths, filePath, "Version 2", version2),
      );

      const fileResult = await fs.readFile(filePath);
      expect(fileResult.data).toBe("Version 2");

      const metadata = throwIfError(getSnapshotMetadata(db));
      expect(metadata).toEqual([
        {
          id: 1,
          path: "test.md",
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

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([{ type: "untracked", path: "test.md" }]);
    });

    it("ignores unchanged files", async () => {
      await saveSnapshot(
        db,
        fs,
        mockConfig.paths,
        filePath,
        "unchanged content",
        version,
        "node",
      );

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([]);
    });

    it("detects updated file with newer mtime", async () => {
      await fs.writeFile(filePath, "original");

      const originalStat = throwIfError(fs.stat(filePath));

      await saveSnapshotMetadata(db, [
        {
          path: "test.md",
          txId: version.id,
          mtime: originalStat.mtime - 1000,
          size: originalStat.size,
          hash: await calculateFileHash(fs, filePath),
        },
      ]);
      await fs.writeFile(filePath, "updated content");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([
        { type: "updated", path: "test.md", txId: version.id },
      ]);
    });

    it("detects outdated file with older mtime", async () => {
      await fs.writeFile(filePath, "current content");

      const currentStat = throwIfError(fs.stat(filePath));

      await saveSnapshotMetadata(db, [
        {
          path: "test.md",
          txId: version.id,
          mtime: currentStat.mtime + 1000,
          size: currentStat.size + 10,
          hash: "different-hash-value",
        },
      ]);

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([
        { type: "outdated", path: "test.md", txId: version.id },
      ]);
    });

    it("detects removed file", async () => {
      await saveSnapshotMetadata(db, [
        {
          path: "test.md",
          txId: version.id,
          mtime: Date.now(),
          size: 100,
          hash: "some-hash",
        },
      ]);

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([
        { type: "removed", path: "test.md", txId: version.id },
      ]);
    });

    it("handles multiple files with different change types", async () => {
      const untracedPath = `${docsPath}/untracked.md`;
      await fs.writeFile(untracedPath, "new content");

      const updatedPath = `${docsPath}/updated.md`;
      await fs.writeFile(updatedPath, "original");
      const updatedStat = throwIfError(fs.stat(updatedPath));

      await saveSnapshotMetadata(db, [
        {
          path: "updated.md",
          txId: 2 as TransactionId,
          mtime: updatedStat.mtime - 1000,
          size: updatedStat.size,
          hash: await calculateFileHash(fs, updatedPath),
        },
        {
          path: "removed.md",
          txId: 3 as TransactionId,
          mtime: Date.now(),
          size: 50,
          hash: "removed-hash",
        },
      ]);
      await fs.writeFile(updatedPath, "modified content");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, docsPath),
      );

      expect(result).toEqual([
        {
          type: "untracked",
          path: "untracked.md",
        },
        {
          type: "updated",
          path: "updated.md",
          txId: 2 as TransactionId,
        },
        {
          type: "removed",
          path: "removed.md",
          txId: 3 as TransactionId,
        },
      ]);
    });

    it("scopes to subdirectory when scopePath provided", async () => {
      const scopeDir = `${docsPath}/tasks`;
      await fs.mkdir(scopeDir, { recursive: true });
      await fs.writeFile(`${scopeDir}/task1.md`, "task content");
      await fs.writeFile(`${docsPath}/other.md`, "other content");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, scopeDir),
      );

      expect(result).toEqual([{ type: "untracked", path: "tasks/task1.md" }]);
    });

    it("only detects removed files in scope when scopePath provided", async () => {
      const scopeDir = `${docsPath}/tasks`;
      await fs.mkdir(scopeDir, { recursive: true });

      await saveSnapshotMetadata(db, [
        {
          path: "tasks/removed1.md",
          txId: version.id,
          mtime: Date.now(),
          size: 50,
          hash: "hash1",
        },
        {
          path: "removed2.md",
          txId: version.id,
          mtime: Date.now(),
          size: 50,
          hash: "hash2",
        },
      ]);

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, scopeDir),
      );

      expect(result).toEqual([
        {
          type: "removed",
          path: "tasks/removed1.md",
          txId: version.id,
        },
      ]);
    });

    it("handles when scopePath is a file", async () => {
      const file1Path = `${docsPath}/file1.md`;
      await fs.writeFile(file1Path, "content 1");
      await fs.writeFile(`${docsPath}/file2.md`, "content 2");

      const file1Stat = throwIfError(fs.stat(file1Path));

      await saveSnapshotMetadata(db, [
        {
          path: "file1.md",
          txId: version.id,
          mtime: file1Stat.mtime - 1000,
          size: file1Stat.size,
          hash: await calculateFileHash(fs, file1Path),
        },
      ]);

      await fs.writeFile(file1Path, "updated content 1");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, file1Path),
      );

      expect(result).toEqual([
        {
          type: "updated",
          path: "file1.md",
          txId: version.id,
        },
      ]);
    });

    it("handles config file from .binder directory", async () => {
      const binderPath = paths.binder;
      await fs.mkdir(binderPath, { recursive: true });
      const configFilePath = `${binderPath}/fields.yaml`;
      await fs.writeFile(configFilePath, "- name: title\n  type: string");

      throwIfError(
        await saveSnapshot(
          db,
          fs,
          paths,
          configFilePath,
          "- name: title\n  type: string",
          version,
          "config",
        ),
      );

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, binderPath),
      );

      expect(result).toEqual([]);
    });

    it("detects new config file in .binder directory", async () => {
      const binderPath = paths.binder;
      await fs.mkdir(binderPath, { recursive: true });
      const configFilePath = `${binderPath}/types.yaml`;
      await fs.writeFile(configFilePath, "- name: Task\n  fields: []");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, binderPath),
      );

      expect(result).toEqual([
        {
          type: "untracked",
          path: ".binder/types.yaml",
        },
      ]);
    });

    it("detects updated config file in .binder directory", async () => {
      const binderPath = paths.binder;
      await fs.mkdir(binderPath, { recursive: true });
      const configFilePath = `${binderPath}/fields.yaml`;
      await fs.writeFile(configFilePath, "original config");

      const originalStat = throwIfError(fs.stat(configFilePath));

      await saveSnapshotMetadata(db, [
        {
          path: ".binder/fields.yaml",
          txId: version.id,
          mtime: originalStat.mtime - 1000,
          size: originalStat.size,
          hash: await calculateFileHash(fs, configFilePath),
        },
      ]);

      await fs.writeFile(configFilePath, "updated config");

      const result = throwIfError(
        await modifiedFiles(db, fs, mockConfig.paths, binderPath),
      );

      expect(result).toEqual([
        {
          type: "updated",
          path: ".binder/fields.yaml",
          txId: version.id,
        },
      ]);
    });
  });
});

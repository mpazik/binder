import { dirname, relative } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import {
  type EntityUid,
  type GraphVersion,
  type TransactionId,
  versionFromTransaction,
} from "@binder/repo";
import { mockTransactionInit } from "@binder/repo/mocks";
import { getTestDatabaseCli } from "../db/db.mock.ts";
import type { DatabaseCli } from "../db";
import { BINDER_DIR } from "../config.ts";
import { mockConfig } from "../runtime.mock.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";
import type { FileSystem } from "./filesystem.ts";
import {
  calculateSnapshotHash,
  getSnapshotMetadata,
  modifiedSnapshots,
  resolveSnapshotPath,
  saveSnapshot,
  saveSnapshotMetadata,
  type SnapshotChangeMetadata,
  type SnapshotMetadata,
} from "./snapshot.ts";

const paths = mockConfig.paths;
const { docs: docsPath } = paths;
const filePath = `${docsPath}/test.md`;
const filePath2 = `${docsPath}/test2.md`;

const version: GraphVersion = versionFromTransaction(mockTransactionInit);
const mockEntityUid = "mock-entity-uid" as EntityUid;

describe("snapshot", () => {
  let fs: FileSystem;
  let db: DatabaseCli;

  beforeEach(async () => {
    fs = createInMemoryFileSystem();
    await fs.mkdir(docsPath, { recursive: true });
    db = getTestDatabaseCli();
  });

  describe("calculateSnapshotHash", () => {
    it("calculates SHA-256 hash of file content", async () => {
      await fs.writeFile(filePath, "hello world");
      const hash = await calculateSnapshotHash(fs, filePath);
      expect(hash).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("returns consistent hash for same file content", async () => {
      await fs.writeFile(filePath, "test content");
      await fs.writeFile(filePath2, "test content");
      const hash1 = await calculateSnapshotHash(fs, filePath);
      const hash2 = await calculateSnapshotHash(fs, filePath2);
      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different file content", async () => {
      await fs.writeFile(filePath, "content one");
      await fs.writeFile(filePath2, "content two");
      const hash1 = await calculateSnapshotHash(fs, filePath);
      const hash2 = await calculateSnapshotHash(fs, filePath2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("saveSnapshot", () => {
    const check = async (
      scenario: { existingContent?: string; newContent: string },
      expectedResult: "written" | "skipped",
    ) => {
      if (scenario.existingContent !== undefined) {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            scenario.existingContent,
            version,
            mockEntityUid,
          ),
        );
      }

      const result = throwIfError(
        await saveSnapshot(
          db,
          fs,
          paths,
          filePath,
          scenario.newContent,
          version,
          mockEntityUid,
        ),
      );
      expect(result).toBe(expectedResult);

      const fileContent = throwIfError(await fs.readFile(filePath));
      expect(fileContent).toBe(scenario.newContent);

      const metadata = throwIfError(getSnapshotMetadata(db));
      expect(metadata).toEqual([
        {
          id: 1,
          path: "test.md",
          txId: version.id,
          entityUid: mockEntityUid,
          ...throwIfError(fs.stat(filePath)),
          hash: await calculateSnapshotHash(fs, filePath),
        },
      ]);
    };

    it("writes new file", async () => {
      await check({ newContent: "hello" }, "written");
    });

    it("skips write when content unchanged", async () => {
      await check({ existingContent: "hello", newContent: "hello" }, "skipped");
    });

    it("writes when content changes", async () => {
      await check({ existingContent: "hello", newContent: "world" }, "written");
    });

    describe("mode=fast (default)", () => {
      it("skips when hash matches without checking file content", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );

        // Simulate a bad edit after failed sync
        await fs.writeFile(filePath, "bad edit");

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "fast",
            },
          ),
        );
        expect(result).toBe("skipped");
        expect(throwIfError(await fs.readFile(filePath))).toBe("bad edit");
      });
    });

    describe("mode=verify", () => {
      it("skips when file content matches snapshot", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "verify",
            },
          ),
        );
        expect(result).toBe("skipped");
      });

      it("returns skipped-diverged when file content differs from snapshot", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );
        await fs.writeFile(filePath, "bad edit");

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "verify",
            },
          ),
        );
        expect(result).toBe("skipped-diverged");
        expect(throwIfError(await fs.readFile(filePath))).toBe("bad edit");
      });

      it("skips when file stat matches snapshot metadata", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "verify",
            },
          ),
        );
        expect(result).toBe("skipped");
      });
    });

    describe("mode=force", () => {
      it("overwrites when file content differs from snapshot", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );
        await fs.writeFile(filePath, "bad edit");

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "force",
            },
          ),
        );
        expect(result).toBe("written");
        expect(throwIfError(await fs.readFile(filePath))).toBe("hello");
      });

      it("skips when file content matches snapshot", async () => {
        throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
          ),
        );

        const result = throwIfError(
          await saveSnapshot(
            db,
            fs,
            paths,
            filePath,
            "hello",
            version,
            mockEntityUid,
            {
              mode: "force",
            },
          ),
        );
        expect(result).toBe("skipped");
      });
    });
  });

  describe("modifiedSnapshots", () => {
    const toAbsolutePath = (path: string) =>
      path.startsWith(BINDER_DIR)
        ? `${paths.binder}/${path.slice(BINDER_DIR.length + 1)}`
        : `${docsPath}/${path}`;

    type MetadataInput = Omit<
      SnapshotMetadata,
      "id" | "txId" | "entityUid" | "mtime" | "size" | "hash"
    > &
      Partial<
        Pick<SnapshotMetadata, "txId" | "entityUid" | "mtime" | "size" | "hash">
      >;

    const check = async (
      scenario: {
        files?: { path: string; content: string }[];
        metadata?: MetadataInput[];
        scope?: string;
        ignorePatterns?: string[];
        includePatterns?: string[];
      },
      expected: SnapshotChangeMetadata[],
    ) => {
      if (scenario.scope) await fs.mkdir(scenario.scope, { recursive: true });
      for (const { path, content } of scenario.files ?? []) {
        const abs = toAbsolutePath(path);
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }

      const metadata = await Promise.all(
        (scenario.metadata ?? []).map(async (m) => {
          const abs = toAbsolutePath(m.path);
          const stat = fs.stat(abs);
          return {
            path: m.path,
            txId: m.txId ?? version.id,
            entityUid: m.entityUid ?? mockEntityUid,
            mtime: m.mtime ?? Date.now() + 1000,
            size: m.size ?? stat.data?.size ?? 0,
            hash:
              m.hash ??
              (stat.data ? await calculateSnapshotHash(fs, abs) : "mock"),
          };
        }),
      );
      await saveSnapshotMetadata(db, metadata);

      const result = throwIfError(
        await modifiedSnapshots(
          db,
          fs,
          mockConfig.paths,
          scenario.scope ?? docsPath,
          {
            exclude: scenario.ignorePatterns,
            include: scenario.includePatterns,
          },
        ),
      );
      expect(result).toEqual(expected);
    };

    it("detects new untracked file", async () => {
      await check({ files: [{ path: "test.md", content: "new content" }] }, [
        { type: "untracked", path: "test.md" },
      ]);
    });

    it("ignores unchanged files", async () => {
      await check(
        {
          files: [{ path: "test.md", content: "unchanged" }],
          metadata: [{ path: "test.md" }],
        },
        [],
      );
    });

    it("detects updated file with newer mtime", async () => {
      await check(
        {
          files: [{ path: "test.md", content: "updated" }],
          metadata: [{ path: "test.md", mtime: 1000, hash: "old" }],
        },
        [
          {
            type: "updated",
            path: "test.md",
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("detects outdated file with older mtime", async () => {
      await check(
        {
          files: [{ path: "test.md", content: "current" }],
          metadata: [
            { path: "test.md", mtime: Date.now() + 10000, hash: "new" },
          ],
        },
        [
          {
            type: "outdated",
            path: "test.md",
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("detects removed file", async () => {
      await check(
        { metadata: [{ path: "test.md", mtime: 1000, size: 10, hash: "x" }] },
        [
          {
            type: "removed",
            path: "test.md",
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("handles multiple files with different change types", async () => {
      await check(
        {
          files: [
            { path: "untracked.md", content: "new" },
            { path: "updated.md", content: "modified" },
          ],
          metadata: [
            {
              path: "updated.md",
              txId: 2 as TransactionId,
              mtime: 1000,
              hash: "old",
            },
            {
              path: "removed.md",
              txId: 3 as TransactionId,
              mtime: 1000,
              size: 5,
              hash: "x",
            },
          ],
        },
        [
          { type: "untracked", path: "untracked.md" },
          {
            type: "updated",
            path: "updated.md",
            txId: 2 as TransactionId,
            entityUid: mockEntityUid,
          },
          {
            type: "removed",
            path: "removed.md",
            txId: 3 as TransactionId,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("scopes to subdirectory when scopePath provided", async () => {
      await check(
        {
          files: [
            { path: "tasks/task1.md", content: "task" },
            { path: "other.md", content: "other" },
          ],
          scope: `${docsPath}/tasks`,
        },
        [{ type: "untracked", path: "tasks/task1.md" }],
      );
    });

    it("only detects removed files in scope when scopePath provided", async () => {
      await check(
        {
          metadata: [
            { path: "tasks/removed1.md", mtime: 1000, size: 5, hash: "a" },
            { path: "removed2.md", mtime: 1000, size: 5, hash: "b" },
          ],
          scope: `${docsPath}/tasks`,
        },
        [
          {
            type: "removed",
            path: "tasks/removed1.md",
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("handles when scopePath is a file", async () => {
      await check(
        {
          files: [
            { path: "file1.md", content: "updated" },
            { path: "file2.md", content: "other" },
          ],
          metadata: [{ path: "file1.md", mtime: 1000, hash: "old" }],
          scope: `${docsPath}/file1.md`,
        },
        [
          {
            type: "updated",
            path: "file1.md",
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("handles unchanged config file in .binder directory", async () => {
      await check(
        {
          files: [{ path: `${BINDER_DIR}/fields.yaml`, content: "config" }],
          metadata: [{ path: `${BINDER_DIR}/fields.yaml` }],
          scope: paths.binder,
        },
        [],
      );
    });

    it("detects new config file in .binder directory", async () => {
      await check(
        {
          files: [
            { path: `${BINDER_DIR}/types.yaml`, content: "- name: Task" },
          ],
          scope: paths.binder,
        },
        [{ type: "untracked", path: `${BINDER_DIR}/types.yaml` }],
      );
    });

    it("detects updated config file in .binder directory", async () => {
      await check(
        {
          files: [{ path: `${BINDER_DIR}/fields.yaml`, content: "updated" }],
          metadata: [
            { path: `${BINDER_DIR}/fields.yaml`, mtime: 1000, hash: "old" },
          ],
          scope: paths.binder,
        },
        [
          {
            type: "updated",
            path: `${BINDER_DIR}/fields.yaml`,
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("does not include config files when scanning docs directory", async () => {
      await check(
        {
          metadata: [
            {
              path: `${BINDER_DIR}/fields.yaml`,
              mtime: 1000,
              size: 5,
              hash: "x",
            },
          ],
        },
        [],
      );
    });

    it("only reports removed files matching includePatterns", async () => {
      await check(
        {
          metadata: [
            {
              path: `${BINDER_DIR}/fields.yaml`,
              mtime: 1000,
              size: 5,
              hash: "a",
            },
            {
              path: `${BINDER_DIR}/backup.bac`,
              mtime: 1000,
              size: 5,
              hash: "b",
            },
          ],
          includePatterns: [`${BINDER_DIR}/*.yaml`],
          scope: paths.binder,
        },
        [
          {
            type: "removed",
            path: `${BINDER_DIR}/fields.yaml`,
            txId: version.id,
            entityUid: mockEntityUid,
          },
        ],
      );
    });

    it("applies both include and exclude patterns", async () => {
      await check(
        {
          files: [
            { path: "tasks/task1.md", content: "task" },
            { path: "tasks/task2.md", content: "task" },
            { path: "tasks/draft.md", content: "draft" },
            { path: "notes/note.md", content: "note" },
          ],
          includePatterns: ["tasks/**/*.md"],
          ignorePatterns: ["**/draft.md"],
        },
        [
          { type: "untracked", path: "tasks/task1.md" },
          { type: "untracked", path: "tasks/task2.md" },
        ],
      );
    });
  });

  describe("resolveSnapshotPath", () => {
    const check = (input: string | undefined, expected: string) => {
      expect(resolveSnapshotPath(input, paths)).toBe(expected);
    };

    it("returns paths.docs when path is undefined", () => {
      check(undefined, paths.docs);
    });

    it("returns absolute path as-is", () => {
      check("/some/absolute/path", "/some/absolute/path");
    });

    it("resolves binder-relative path against paths.root", () => {
      check(
        `${BINDER_DIR}/config.yaml`,
        `${paths.root}/${BINDER_DIR}/config.yaml`,
      );
    });

    it("resolves root-relative docs path against paths.root", () => {
      const docsDir = relative(paths.root, paths.docs);
      check(`${docsDir}/tasks/foo.md`, `${paths.root}/${docsDir}/tasks/foo.md`);
    });

    it("resolves snapshot-relative path against paths.docs", () => {
      check("tasks/foo.md", `${paths.docs}/tasks/foo.md`);
    });
  });
});

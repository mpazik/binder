import { beforeEach, describe, expect, it } from "bun:test";
import { err, createError, isOk, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  type EntityChangesetInput,
  type KnowledgeGraph,
  changesetInputForNewEntity,
  openKnowledgeGraph,
} from "@binder/repo";
import {
  mockTransactionInitInput,
  mockTask1Uid,
  mockTask1Key,
  mockTask2Uid,
  mockTask2Key,
  mockProjectKey,
} from "@binder/repo/mocks";
import type { DatabaseCli } from "../db";
import { getTestDatabaseCli } from "../db/db.mock.ts";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "../lib/filesystem.mock.ts";
import { mockConfig, mockLog } from "../runtime.mock.ts";
import { cliConfigSchema } from "../cli-config-schema.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import { loadViews } from "./view-entity.ts";
import { renderDocs } from "./repository.ts";
import {
  mockNavCompletedTasksEntity,
  mockNavPendingTasksEntity,
  mockNavProjectsByKeyEntity,
  mockStatusNavConfigInput,
  mockTaskStatusViewEntity,
  mockTaskStatusViewKey,
} from "./navigation.mock.ts";

/** Wraps a FileSystem to inject write failures for paths matching a predicate. */
const createFailingFileSystem = (
  base: MockFileSystem,
  shouldFail: (path: string) => boolean,
): FileSystem & { files: MockFileSystem["files"] } => ({
  ...base,
  files: base.files,
  writeFile: async (path: string, content: string) => {
    if (shouldFail(path)) {
      return err(
        createError("write-failed", `Simulated write failure: ${path}`),
      );
    }
    return base.writeFile(path, content);
  },
});

describe("renderDocs", () => {
  let db: DatabaseCli;
  let kg: KnowledgeGraph;
  let baseFs: MockFileSystem;
  const paths = mockConfig.paths;

  const doRender = (fs: FileSystem = baseFs) =>
    renderDocs({
      db,
      kg,
      fs,
      log: mockLog,
      config: mockConfig,
      views: () => loadViews(kg),
    });

  beforeEach(async () => {
    db = getTestDatabaseCli();
    kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
    baseFs = createInMemoryFileSystem();

    throwIfError(await kg.update(mockTransactionInitInput));
    throwIfError(
      await kg.update({
        author: "test",
        configs: [
          changesetInputForNewEntity<"config">(mockTaskStatusViewEntity),
        ],
      }),
    );
  });

  describe("file cleanup on entity move", () => {
    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: mockStatusNavConfigInput,
        }),
      );
      throwIfError(await doRender());
    });

    /** Update entity statuses, re-render, and verify file locations. */
    const check = async (
      updates: EntityChangesetInput<"record">[],
      expected: { exists: string[]; removed: string[] },
    ) => {
      throwIfError(await kg.update({ author: "test", records: updates }));
      throwIfError(await doRender());
      for (const path of expected.exists) {
        expect(await baseFs.exists(`${paths.docs}/${path}`)).toBe(true);
      }
      for (const path of expected.removed) {
        expect(await baseFs.exists(`${paths.docs}/${path}`)).toBe(false);
      }
    };

    it("removes old file when entity moves from pending to complete", async () => {
      await check([{ $ref: mockTask1Uid, status: "complete" }], {
        exists: [`archive/tasks/${mockTask1Key}.md`],
        removed: [`tasks/medium ${mockTask1Key}.md`],
      });
    });

    it("removes old file when entity moves through archived and back", async () => {
      await check([{ $ref: mockTask1Uid, status: "archived" }], {
        exists: [`tasks/backlog/medium ${mockTask1Key}.md`],
        removed: [`tasks/medium ${mockTask1Key}.md`],
      });
      await check([{ $ref: mockTask1Uid, status: "pending" }], {
        exists: [`tasks/medium ${mockTask1Key}.md`],
        removed: [`tasks/backlog/medium ${mockTask1Key}.md`],
      });
    });

    it("removes both old files when two entities move simultaneously", async () => {
      await check(
        [
          { $ref: mockTask1Uid, status: "complete" },
          { $ref: mockTask2Uid, status: "complete" },
        ],
        {
          exists: [
            `archive/tasks/${mockTask1Key}.md`,
            `archive/tasks/${mockTask2Key}.md`,
          ],
          removed: [
            `tasks/medium ${mockTask1Key}.md`,
            `tasks/medium ${mockTask2Key}.md`,
          ],
        },
      );
    });

    it("handles entities swapping locations", async () => {
      await check([{ $ref: mockTask1Uid, status: "complete" }], {
        exists: [`archive/tasks/${mockTask1Key}.md`],
        removed: [`tasks/medium ${mockTask1Key}.md`],
      });
      await check(
        [
          { $ref: mockTask1Uid, status: "active" },
          { $ref: mockTask2Uid, status: "complete" },
        ],
        {
          exists: [
            `tasks/medium ${mockTask1Key}.md`,
            `archive/tasks/${mockTask2Key}.md`,
          ],
          removed: [
            `archive/tasks/${mockTask1Key}.md`,
            `tasks/medium ${mockTask2Key}.md`,
          ],
        },
      );
    });

    it("removes file when entity status matches no nav filter", async () => {
      // "cancelled" is not covered by any of the 3 status nav items
      await check(
        [
          {
            $ref: mockTask1Uid,
            status: "cancelled",
            cancelReason: "duplicate",
          },
        ],
        {
          exists: [],
          removed: [`tasks/medium ${mockTask1Key}.md`],
        },
      );
    });
  });

  describe("render result", () => {
    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
          ],
        }),
      );
    });

    it("returns modified paths on first render", async () => {
      const result = throwIfError(await doRender());

      expect(result.modifiedPaths).toContain(`tasks/medium ${mockTask1Key}.md`);
      expect(result.modifiedPaths).toContain(`tasks/medium ${mockTask2Key}.md`);
    });

    it("returns empty modified paths when nothing changed", async () => {
      throwIfError(await doRender());
      const result = throwIfError(await doRender());

      expect(result.modifiedPaths).toEqual([]);
    });

    it("force overwrites externally modified files", async () => {
      throwIfError(await doRender());

      const filePath = `${paths.docs}/tasks/medium ${mockTask1Key}.md`;
      const original = baseFs.files.get(filePath)!;
      baseFs.files.set(filePath, {
        ...original,
        content: original.content + "\n<!-- user edit -->",
        mtime: original.mtime + 1000,
      });

      const result = throwIfError(
        await renderDocs({
          db,
          kg,
          fs: baseFs,
          log: mockLog,
          config: mockConfig,
          views: () => loadViews(kg),
          force: true,
        }),
      );

      expect(result.modifiedPaths).toContain(`tasks/medium ${mockTask1Key}.md`);
      expect(baseFs.files.get(filePath)!.content).not.toContain(
        "<!-- user edit -->",
      );
    });

    it("reports diverged paths when file was externally modified", async () => {
      throwIfError(await doRender());

      const filePath = `${paths.docs}/tasks/medium ${mockTask1Key}.md`;
      const original = baseFs.files.get(filePath)!;
      baseFs.files.set(filePath, {
        ...original,
        content: original.content + "\n<!-- user edit -->",
        mtime: original.mtime + 1000,
      });

      const result = await renderDocs({
        db,
        kg,
        fs: baseFs,
        log: mockLog,
        config: mockConfig,
        views: () => loadViews(kg),
        force: false,
      });

      expect(result).toBeOk();
      if (isOk(result)) {
        expect(result.data.divergedPaths).toContain(
          `tasks/medium ${mockTask1Key}.md`,
        );
      }
    });
  });

  describe("partial render failure", () => {
    it("removes stale files when a later navigation item fails", async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
            changesetInputForNewEntity<"config">(mockNavCompletedTasksEntity),
          ],
        }),
      );
      throwIfError(await doRender());

      const oldPath = `${paths.docs}/tasks/medium ${mockTask1Key}.md`;
      expect(await baseFs.exists(oldPath)).toBe(true);

      throwIfError(
        await kg.update({
          author: "test",
          records: [{ $ref: mockTask1Uid, status: "complete" }],
        }),
      );
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">({
              ...mockNavProjectsByKeyEntity,
              view: mockTaskStatusViewKey,
            }),
          ],
        }),
      );

      const failingFs = createFailingFileSystem(baseFs, (path) =>
        path.includes("/projects/"),
      );
      const result = await doRender(failingFs);
      expect(result).toBeErr();

      expect(await baseFs.exists(oldPath)).toBe(false);
    });

    it("does not delete files from nav items that succeeded", async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
            changesetInputForNewEntity<"config">({
              ...mockNavProjectsByKeyEntity,
              view: mockTaskStatusViewKey,
            }),
          ],
        }),
      );
      throwIfError(await doRender());

      const task2Path = `${paths.docs}/tasks/medium ${mockTask2Key}.md`;
      expect(await baseFs.exists(task2Path)).toBe(true);

      // Delete project files to force re-write on next render
      for (const f of baseFs.files.keys()) {
        if (f.includes("/projects/")) baseFs.files.delete(f);
      }

      const failingFs = createFailingFileSystem(baseFs, (path) =>
        path.includes("/projects/"),
      );
      const result = await doRender(failingFs);
      expect(result).toBeErr();

      expect(await baseFs.exists(task2Path)).toBe(true);
    });

    it("returns render-partial error with collected error details", async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
            changesetInputForNewEntity<"config">({
              ...mockNavProjectsByKeyEntity,
              view: mockTaskStatusViewKey,
            }),
          ],
        }),
      );

      const failingFs = createFailingFileSystem(baseFs, (path) =>
        path.includes("/projects/"),
      );
      const result = await doRender(failingFs);

      expect(result).toBeErrWithKey("render-partial");
    });
  });

  describe("mixed entity types", () => {
    it("renders project yaml alongside task markdown", async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
            changesetInputForNewEntity<"config">(mockNavProjectsByKeyEntity),
          ],
        }),
      );

      const result = throwIfError(await doRender());

      expect(
        await baseFs.exists(`${paths.docs}/tasks/medium ${mockTask1Key}.md`),
      ).toBe(true);
      expect(
        await baseFs.exists(`${paths.docs}/projects/${mockProjectKey}.yaml`),
      ).toBe(true);
      expect(result.modifiedPaths).toContain(`projects/${mockProjectKey}.yaml`);
    });
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  changesetInputForNewEntity,
  type KnowledgeGraph,
  openKnowledgeGraph,
} from "@binder/repo";
import type { PluginRepo } from "@binder/repo/local";
import {
  mockProjectUid,
  mockTask1Key,
  mockTask1Uid,
  mockTransactionInitInput,
} from "@binder/repo/mocks";
import type { DatabaseCli } from "../../db";
import { getTestDatabaseCli } from "../../db/db.mock.ts";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "../../lib/filesystem.mock.ts";
import { mockConfig, mockLog } from "../../runtime.mock.ts";
import { cliConfigSchema } from "../../cli-config-schema.ts";
import { createViewCache } from "../../document/view-entity.ts";
import {
  mockStatusNavConfigInput,
  mockTaskStatusViewEntity,
} from "../../document/navigation.mock.ts";
import { docsPlugin } from "./index.ts";

const taskFilePath = `${mockConfig.paths.docs}/tasks/medium ${mockTask1Key}.md`;

describe("docsPlugin", () => {
  let db: DatabaseCli;
  let kg: KnowledgeGraph;
  let fs: MockFileSystem;
  let events: string[];
  let updatedPaths: string[][];

  beforeEach(async () => {
    db = getTestDatabaseCli();
    fs = createInMemoryFileSystem();
    events = [];
    updatedPaths = [];
    await fs.mkdir(mockConfig.paths.docs, { recursive: true });

    kg = openKnowledgeGraph(db, {
      configSchema: cliConfigSchema,
      onSubscriberError: (error, context) => {
        events.push(`error:${context.subscriber}:${error.key}`);
      },
    });

    // Seed schema, records, and view/nav configs before the plugin is
    // registered, so setup commits don't render.
    throwIfError(await kg.update(mockTransactionInitInput));
    throwIfError(
      await kg.update({
        author: "test",
        configs: [
          changesetInputForNewEntity<"config">(mockTaskStatusViewEntity),
          ...mockStatusNavConfigInput,
        ],
      }),
    );

    const viewCache = createViewCache(kg);

    // Mirrors runtime.ts wiring: journal subscribed first, docs second.
    kg.onCommit(
      undefined,
      () => {
        events.push("journal");
      },
      "journal",
    );
    await docsPlugin({
      context: () => {
        events.push("docs:start");
        return {
          db,
          fs,
          log: mockLog,
          config: mockConfig,
          views: () => viewCache.load(),
          invalidateCaches: () => {
            events.push("docs:invalidate");
            viewCache.invalidate();
          },
          onFilesUpdated: (paths) => {
            updatedPaths.push(paths);
          },
        };
      },
    }).register?.({ repo: kg as unknown as PluginRepo });
  });

  const updateTaskTitle = (title: string) =>
    kg.update({ author: "test", records: [{ $ref: mockTask1Uid, title }] });

  const setViewTemplate = (viewContent: string) =>
    kg.update({
      author: "test",
      configs: [{ $ref: mockTaskStatusViewEntity.uid, viewContent }],
    });

  const readTaskFile = async () =>
    throwIfError(await fs.readFile(taskFilePath));

  describe("rendering and notifications", () => {
    it("renders matching entities on commit and notifies onFilesUpdated", async () => {
      throwIfError(await updateTaskTitle("Updated title"));

      expect(await fs.exists(taskFilePath)).toBe(true);
      expect(await readTaskFile()).toContain("Updated title");
      expect(updatedPaths.length).toBe(1);
      expect(updatedPaths[0]).toContain(`tasks/medium ${mockTask1Key}.md`);
      expect(events).not.toContain(`error:docs:render-partial`);
    });

    it("re-renders and notifies on rollback", async () => {
      throwIfError(await updateTaskTitle("Committed then reverted"));
      expect(await readTaskFile()).toContain("Committed then reverted");
      updatedPaths = [];

      throwIfError(await kg.rollback(1));

      // File reflects the reverted state, not the rolled-back title.
      expect(await readTaskFile()).not.toContain("Committed then reverted");
      expect(updatedPaths.length).toBe(1);
      expect(updatedPaths[0]).toContain(`tasks/medium ${mockTask1Key}.md`);
    });

    it("does not notify onFilesUpdated when no rendered file changes", async () => {
      throwIfError(await updateTaskTitle("Warm cache"));
      updatedPaths = [];

      // Project entities match no nav item; nothing re-renders.
      throwIfError(
        await kg.update({
          author: "test",
          records: [{ $ref: mockProjectUid, description: "Untracked change" }],
        }),
      );

      expect(updatedPaths).toEqual([]);
    });
  });

  describe("cache invalidation", () => {
    it("skips cache invalidation for record-only transactions", async () => {
      throwIfError(await updateTaskTitle("No config change"));

      expect(events).not.toContain("docs:invalidate");
    });

    it("invalidates view caches before render on config-changing transactions", async () => {
      throwIfError(await updateTaskTitle("Warm cache"));

      // Change the view template; the same-process render must pick it up.
      throwIfError(await setViewTemplate("# {title}\n\nTEMPLATE CHANGED\n"));

      expect(events).toContain("docs:invalidate");
      expect(await readTaskFile()).toContain("TEMPLATE CHANGED");
    });

    it("invalidates caches on rollback of a config-changing transaction", async () => {
      throwIfError(await updateTaskTitle("Warm cache"));
      // Commit a view-template change, then roll it back.
      throwIfError(
        await setViewTemplate("# {title}\n\nROLLED BACK TEMPLATE\n"),
      );
      expect(await readTaskFile()).toContain("ROLLED BACK TEMPLATE");
      events.length = 0;

      throwIfError(await kg.rollback(1));

      expect(events).toContain("docs:invalidate");
      // Render uses the original template again after invalidation.
      expect(await readTaskFile()).not.toContain("ROLLED BACK TEMPLATE");
    });
  });

  describe("subscription wiring", () => {
    it("fires the journal handler before the docs render", async () => {
      throwIfError(await updateTaskTitle("Order check"));

      expect(events.indexOf("journal")).toBeGreaterThanOrEqual(0);
      expect(events.indexOf("journal")).toBeLessThan(
        events.indexOf("docs:start"),
      );
    });

    it("does nothing without an injected context", async () => {
      const bare = openKnowledgeGraph(getTestDatabaseCli(), {
        configSchema: cliConfigSchema,
      });
      throwIfError(await bare.update(mockTransactionInitInput));

      const plugin = docsPlugin();
      await plugin.register?.({ repo: bare as unknown as PluginRepo });

      throwIfError(
        await bare.update({
          author: "test",
          records: [{ $ref: mockTask1Uid, title: "No render" }],
        }),
      );
      // No context, no subscription — nothing recorded, nothing rendered.
      expect(events).not.toContain("docs:start");
    });
  });
});

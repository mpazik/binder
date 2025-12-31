import { dirname, join } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type EntityChangesetInput, type KnowledgeGraph } from "@binder/db";
import {
  mockNodeSchema,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
  mockTask2Uid,
  mockTaskType,
  mockTaskTypeKey,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "./document.mock.ts";
import { mockNavigationConfigInput } from "./navigation.mock.ts";
import { synchronizeFile, synchronizeModifiedFiles } from "./synchronizer.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { type NavigationItem } from "./navigation.ts";

const navigationItems: NavigationItem[] = [
  {
    path: "tasks/{key}",
    view: `# {title}

**Status:** {status}

## Description

{description}
`,
  },
  {
    path: "tasks/{key}",
    includes: { title: true, status: true, description: true },
  },
  {
    path: "all-tasks",
    query: { filters: { type: "Task" } },
  },
];

const taskMarkdown = (
  title: string,
  status: string,
  description: string,
) => `# ${title}

**Status:** ${status}

## Description

${description}
`;

describe("synchronizeFile", () => {
  let ctx: RuntimeContextWithDb;
  let kg: KnowledgeGraph;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    kg = ctx.kg;
    throwIfError(await kg.update(mockTransactionInitInput));
    throwIfError(await kg.update(mockDocumentTransactionInput));
  });

  const check = async (
    filePath: string,
    content: string,
    expectedNodes: EntityChangesetInput<"node">[],
  ) => {
    const fullPath = join(ctx.config.paths.docs, filePath);
    throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
    throwIfError(await ctx.fs.writeFile(fullPath, content));
    const result = throwIfError(
      await synchronizeFile(
        ctx.fs,
        kg,
        ctx.config,
        navigationItems,
        mockNodeSchema,
        filePath,
        "node",
      ),
    );
    expect(result).toEqual(expectedNodes);
  };

  describe("markdown task", () => {
    it("returns empty array when no changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        taskMarkdown(
          mockTask1Node.title,
          mockTask1Node.status,
          mockTask1Node.description,
        ),
        [],
      );
    });

    it("detects field changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        taskMarkdown("Updated Task Title", "done", "New description text"),
        [
          {
            $ref: mockTask1Uid,
            title: "Updated Task Title",
            status: "done",
            description: "New description text",
          },
        ],
      );
    });
  });

  describe("yaml single entity", () => {
    it("returns empty array when no changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.yaml`,
        renderYamlEntity({
          title: mockTask1Node.title,
          status: mockTask1Node.status,
          description: mockTask1Node.description,
        }),
        [],
      );
    });

    it("detects field changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.yaml`,
        renderYamlEntity({
          title: "Updated Task Title",
          status: "done",
          description: mockTask1Node.description,
        }),
        [{ $ref: mockTask1Uid, title: "Updated Task Title", status: "done" }],
      );
    });
  });

  describe("yaml list", () => {
    it("returns empty array when no changes", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([mockTask1Node, mockTask2Node]),
        [],
      );
    });

    it("detects new items in list", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([
          mockTask1Node,
          mockTask2Node,
          { type: mockTaskTypeKey, title: "New Task", status: "todo" },
        ]),
        [{ type: mockTaskTypeKey, title: "New Task", status: "todo" }],
      );
    });

    it("detects multiple changes", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([
          { ...mockTask1Node, title: "Modified Task 1" },
          { ...mockTask2Node, status: "done" },
        ]),
        [
          { $ref: mockTask1Uid, title: "Modified Task 1" },
          { $ref: mockTask2Uid, status: "done" },
        ],
      );
    });
  });

  describe("synchronizeModifiedFiles", () => {
    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configurations: mockNavigationConfigInput,
        }),
      );
    });

    it("returns null when no modified files in docs folder", async () => {
      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.db,
          ctx.fs,
          ctx.kg,
          ctx.config,
          ctx.config.paths.docs,
        ),
      );
      expect(result).toEqual(null);
    });

    it("detects changes in a single modified file", async () => {
      const fullPath = join(ctx.config.paths.docs, "all-tasks.yaml");
      throwIfError(
        await ctx.fs.writeFile(
          fullPath,
          renderYamlList([{ ...mockTask1Node, title: "Updated Title" }]),
        ),
      );

      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.db,
          ctx.fs,
          ctx.kg,
          ctx.config,
          ctx.config.paths.docs,
        ),
      );

      expect(result).toMatchObject({
        author: ctx.config.author,
        nodes: [{ $ref: mockTask1Uid, title: "Updated Title" }],
        configurations: [],
      });
    });

    it("detects changes when scoped to specific file", async () => {
      const fullPath = join(ctx.config.paths.docs, "all-tasks.yaml");
      throwIfError(
        await ctx.fs.writeFile(
          fullPath,
          renderYamlList([{ ...mockTask1Node, title: "Scoped Update" }]),
        ),
      );

      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.db,
          ctx.fs,
          ctx.kg,
          ctx.config,
          fullPath,
        ),
      );

      expect(result).toMatchObject({
        nodes: [{ $ref: mockTask1Uid, title: "Scoped Update" }],
      });
    });

    it("detects changes in config namespace", async () => {
      const configFile = join(ctx.config.paths.binder, "types.yaml");
      throwIfError(
        await ctx.fs.writeFile(
          configFile,
          renderYamlList([{ ...mockTaskType, name: "Updated Task Type" }]),
        ),
      );

      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.db,
          ctx.fs,
          ctx.kg,
          ctx.config,
          configFile,
        ),
      );

      expect(result).toMatchObject({
        nodes: [],
        configurations: [{ $ref: mockTaskType.uid, name: "Updated Task Type" }],
      });
    });
  });
});

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
  mockTaskTypeKey,
} from "@binder/db/mocks";
import type { CommandContextWithDb } from "../bootstrap.ts";
import { createMockCommandContextWithDb } from "../bootstrap.mock.ts";
import type { FileChangeMetadata } from "../lib/snapshot.ts";
import { documentSchemaTransactionInput } from "./document-schema.ts";
import {
  mockCoreTransactionInputForDocs,
  mockDocumentTransactionInput,
} from "./document.mock.ts";
import { synchronizeFile, synchronizeModifiedFiles } from "./synchronizer.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { type NavigationItem } from "./navigation.ts";

const navigationItems: NavigationItem[] = [
  {
    path: "tasks/{key}.md",
    view: `# {title}

**Status:** {status}

## Description

{description}
`,
  },
  {
    path: "tasks/{key}.yaml",
    includes: { title: true, status: true, description: true },
  },
  {
    path: "all-tasks.yaml",
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
  let ctx: CommandContextWithDb;
  let kg: KnowledgeGraph;

  const mockFileChange = (relativePath: string): FileChangeMetadata => ({
    type: "updated",
    path: relativePath,
    txId: 1 as any,
  });

  beforeEach(async () => {
    ctx = await createMockCommandContextWithDb();
    kg = ctx.kg;
    throwIfError(await kg.update(documentSchemaTransactionInput));
    throwIfError(await kg.update(mockCoreTransactionInputForDocs));
    throwIfError(await kg.update(mockDocumentTransactionInput));
  });

  const check = async (
    filePath: string,
    content: string,
    expectedNodes: EntityChangesetInput<"node">[] | null,
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
      ),
    );
    const expected = expectedNodes
      ? { author: ctx.config.author, nodes: expectedNodes }
      : null;
    expect(result).toEqual(expected);
  };

  describe("markdown task", () => {
    it("returns null when no changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        taskMarkdown(
          mockTask1Node.title,
          mockTask1Node.status,
          mockTask1Node.description,
        ),
        null,
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
    it("returns null when no changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.yaml`,
        renderYamlEntity({
          title: mockTask1Node.title,
          status: mockTask1Node.status,
          description: mockTask1Node.description,
        }),
        null,
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
    it("returns null when no changes", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([mockTask1Node, mockTask2Node]),
        null,
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
    it("returns null when no modified files", async () => {
      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.fs,
          kg,
          ctx.config,
          navigationItems,
          mockNodeSchema,
          [],
        ),
      );
      expect(result).toEqual(null);
    });

    it("merges changes from multiple files", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        taskMarkdown("Updated Task 1", "done", mockTask1Node.description),
        [{ $ref: mockTask1Uid, title: "Updated Task 1", status: "done" }],
      );
      await check(
        `tasks/${mockTask2Node.key}.md`,
        taskMarkdown(mockTask2Node.title, "in-progress", "Updated description"),
        [
          {
            $ref: mockTask2Uid,
            status: "in-progress",
            description: "Updated description",
          },
        ],
      );

      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.fs,
          kg,
          ctx.config,
          navigationItems,
          mockNodeSchema,
          [
            mockFileChange(`tasks/${mockTask1Node.key}.md`),
            mockFileChange(`tasks/${mockTask2Node.key}.md`),
          ],
        ),
      );

      expect(result).toEqual({
        author: ctx.config.author,
        nodes: [
          {
            $ref: mockTask1Uid,
            title: "Updated Task 1",
            status: "done",
          },
          {
            $ref: mockTask2Uid,
            status: "in-progress",
            description: "Updated description",
          },
        ],
      });
    });

    it("returns null when all files have no changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        taskMarkdown(
          mockTask1Node.title,
          mockTask1Node.status,
          mockTask1Node.description,
        ),
        null,
      );

      const result = throwIfError(
        await synchronizeModifiedFiles(
          ctx.fs,
          kg,
          ctx.config,
          navigationItems,
          mockNodeSchema,
          [mockFileChange(`tasks/${mockTask1Node.key}.md`)],
        ),
      );

      expect(result).toEqual(null);
    });
  });
});

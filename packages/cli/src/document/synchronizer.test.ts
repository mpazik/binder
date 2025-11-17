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
import type { CommandContextWithDbWrite } from "../bootstrap.ts";
import { createMockCommandContextWithDb } from "../bootstrap.mock.ts";
import { documentSchemaTransactionInput } from "./document-schema.ts";
import {
  mockCoreTransactionInputForDocs,
  mockDocumentTransactionInput,
} from "./document.mock.ts";
import { synchronizeFile } from "./synchronizer.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { type NavigationItem } from "./navigation.ts";

describe("synchronizeFile", () => {
  let ctx: CommandContextWithDbWrite;
  let kg: KnowledgeGraph;

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
        fullPath,
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
        `# ${mockTask1Node.title}

**Status:** ${mockTask1Node.status}

## Description

${mockTask1Node.description}
`,
        null,
      );
    });

    it("detects field changes", async () => {
      await check(
        `tasks/${mockTask1Node.key}.md`,
        `# Updated Task Title

**Status:** done

## Description

New description text
`,
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
});

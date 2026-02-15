import { dirname, join } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { pick, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type EntityChangesetInput, type KnowledgeGraph } from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockProjectUid,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTask2Uid,
  mockTask3Record,
  mockTask3Uid,
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
import {
  mockPreambleStatusInBodyTemplate,
  mockPreambleTemplate,
  mockTemplates,
} from "./template.mock.ts";

const navigationItems: NavigationItem[] = [
  {
    path: "tasks/{key}",
    template: "task-template",
  },
  {
    path: "tasks/{key}",
    includes: { title: true, status: true, description: true },
  },
  {
    path: "all-tasks",
    query: { filters: { type: "Task" } },
  },
  {
    path: "projects/{key}",
    includes: {
      title: true,
      status: true,
      tasks: { title: true, status: true },
    },
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
    expectedNodes: EntityChangesetInput<"record">[],
  ) => {
    const fullPath = join(ctx.config.paths.docs, filePath);
    throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
    throwIfError(await ctx.fs.writeFile(fullPath, content));
    const result = throwIfError(
      await synchronizeFile(
        ctx.fs,
        ctx.db,
        kg,
        ctx.config,
        throwIfError(await kg.version()),
        navigationItems,
        mockRecordSchema,
        filePath,
        "record",
        mockTemplates,
      ),
    );
    expect(result).toEqual(expectedNodes);
  };

  describe("markdown task", () => {
    it("returns empty array when no changes", async () => {
      await check(
        `tasks/${mockTask1Record.key}.md`,
        taskMarkdown(
          mockTask1Record.title,
          mockTask1Record.status,
          mockTask1Record.description,
        ),
        [],
      );
    });

    it("detects field changes", async () => {
      await check(
        `tasks/${mockTask1Record.key}.md`,
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

  describe("markdown with preamble", () => {
    it("propagates field-conflict when frontmatter and body diverge", async () => {
      const preambleTemplates = [
        mockPreambleTemplate,
        mockPreambleStatusInBodyTemplate,
        ...mockTemplates,
      ];
      const preambleNavItems: NavigationItem[] = [
        { path: "tasks/{key}", template: "task-status-body" },
      ];
      const markdown = `---
status: active
---

# ${mockTask1Record.title}

**Status:** done
`;
      const filePath = `tasks/${mockTask1Record.key}.md`;
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, markdown));
      const result = await synchronizeFile(
        ctx.fs,
        ctx.db,
        kg,
        ctx.config,
        throwIfError(await kg.version()),
        preambleNavItems,
        mockRecordSchema,
        filePath,
        "record",
        preambleTemplates,
      );
      expect(result).toBeErrWithKey("field-conflict");
    });
  });

  describe("yaml single entity", () => {
    it("returns empty array when no changes", async () => {
      await check(
        `tasks/${mockTask1Record.key}.yaml`,
        renderYamlEntity(
          pick(mockTask1Record, ["title", "status", "description"]),
        ),
        [],
      );
    });

    it("detects field changes", async () => {
      await check(
        `tasks/${mockTask1Record.key}.yaml`,
        renderYamlEntity({
          title: "Updated Task Title",
          status: "done",
          description: mockTask1Record.description,
        }),
        [{ $ref: mockTask1Uid, title: "Updated Task Title", status: "done" }],
      );
    });
  });

  describe("yaml with nested includes", () => {
    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          records: [
            pick(mockTask3Record, [
              "uid",
              "type",
              "title",
              "status",
              "project",
            ]),
          ],
        }),
      );
    });

    it("detects removed task from project", async () => {
      await check(
        `projects/${mockProjectRecord.key}.yaml`,
        renderYamlEntity({
          ...pick(mockProjectRecord, ["title", "status"]),
          tasks: [pick(mockTask2Record, ["uid", "title", "status"])],
        }),
        [{ $ref: mockProjectUid, tasks: [["remove", mockTask3Uid]] }],
      );
    });
  });

  describe("yaml list", () => {
    it("returns empty array when no changes", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([mockTask1Record, mockTask2Record]),
        [],
      );
    });

    it("detects new items in list", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([
          mockTask1Record,
          mockTask2Record,
          { type: mockTaskTypeKey, title: "New Task", status: "todo" },
        ]),
        [{ type: mockTaskTypeKey, title: "New Task", status: "todo" }],
      );
    });

    it("detects multiple changes", async () => {
      await check(
        "all-tasks.yaml",
        renderYamlList([
          { ...mockTask1Record, title: "Modified Task 1" },
          { ...mockTask2Record, status: "done" },
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
          configs: mockNavigationConfigInput,
        }),
      );
    });

    const check = async (
      filePath: string,
      content: string,
      expected: Record<string, unknown> | null,
    ) => {
      throwIfError(await ctx.fs.writeFile(filePath, content));
      const result = throwIfError(
        await synchronizeModifiedFiles(ctx, filePath),
      );
      if (expected === null) {
        expect(result).toEqual(null);
      } else {
        expect(result).toMatchObject(expected);
      }
    };

    it("returns null when no modified files in docs folder", async () => {
      const result = throwIfError(
        await synchronizeModifiedFiles(ctx, ctx.config.paths.docs),
      );
      expect(result).toEqual(null);
    });

    it("detects changes in a single modified file", async () => {
      await check(
        join(ctx.config.paths.docs, "all-tasks.yaml"),
        renderYamlList([{ ...mockTask1Record, title: "Updated Title" }]),
        {
          author: ctx.config.author,
          records: [{ $ref: mockTask1Uid, title: "Updated Title" }],
          configs: [],
        },
      );
    });

    it("detects changes when scoped to specific file", async () => {
      await check(
        join(ctx.config.paths.docs, "all-tasks.yaml"),
        renderYamlList([{ ...mockTask1Record, title: "Scoped Update" }]),
        { records: [{ $ref: mockTask1Uid, title: "Scoped Update" }] },
      );
    });

    it("detects conflict when two files change same entity field to different values", async () => {
      const yamlPath = join(
        ctx.config.paths.docs,
        `tasks/${mockTask1Record.key}.yaml`,
      );
      const mdPath = join(
        ctx.config.paths.docs,
        `md-tasks/${mockTask1Record.key}.md`,
      );

      throwIfError(await ctx.fs.mkdir(dirname(yamlPath), { recursive: true }));
      throwIfError(await ctx.fs.mkdir(dirname(mdPath), { recursive: true }));

      throwIfError(
        await ctx.fs.writeFile(
          yamlPath,
          renderYamlEntity({
            title: "Title From YAML",
            status: mockTask1Record.status,
          }),
        ),
      );
      throwIfError(
        await ctx.fs.writeFile(
          mdPath,
          `---
status: ${mockTask1Record.status}
---

# Title From Markdown

## Description

${mockTask1Record.description}
`,
        ),
      );

      const result = await synchronizeModifiedFiles(ctx, ctx.config.paths.docs);
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("detects changes in config namespace", async () => {
      await check(
        join(ctx.config.paths.binder, "types.yaml"),
        renderYamlList([{ ...mockTaskType, name: "Updated Task Type" }]),
        {
          records: [],
          configs: [{ $ref: mockTaskType.uid, name: "Updated Task Type" }],
        },
      );
    });
  });
});

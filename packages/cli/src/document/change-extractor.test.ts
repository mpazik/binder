import { dirname, join } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { pick, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  type EntityChangesetInput,
  type EntityKey,
  type EntitySchema,
  type KnowledgeGraph,
} from "@binder/db";
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
  mockProjectType,
  mockTaskType,
  mockTaskTypeKey,
  mockTeamType,
  mockTeamTypeKey,
  mockTransactionInitInput,
  mockUserType,
} from "@binder/db/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "./document.mock.ts";
import { mockNavigationConfigInput } from "./navigation.mock.ts";
import {
  extractFileChanges,
  extractModifiedFileChanges,
} from "./change-extractor.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { type NavigationItem } from "./navigation.ts";
import {
  mockPreambleStatusInBodyView,
  mockPreambleView,
  mockViews,
} from "./view.mock.ts";
import { createViewEntity } from "./view-entity.ts";

const navigationItems: NavigationItem[] = [
  {
    path: "tasks/{key}",
    view: "task-view",
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

describe("change-extractor", () => {
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
      await extractFileChanges(
        { ...ctx, kg },
        navigationItems,
        mockRecordSchema,
        filePath,
        "record",
        mockViews,
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
            uid: mockTask1Uid,
            title: "Updated Task Title",
            status: "done",
            description: "New description text",
          },
        ],
      );
    });
  });

  describe("markdown with sub-view relation slot", () => {
    const projectView = createViewEntity(
      "project-tasks-view",
      `# {title}\n\n## Tasks\n\n{tasks|view:__section__}\n\n## Description\n\n{description}\n`,
    );
    // resolveAllViewIncludes merges sub-view includes into the relation
    // field, but only runs inside loadViews. Replicate for ad-hoc views.
    projectView.viewIncludes = {
      title: true,
      tasks: { title: true, description: true },
      description: true,
    };

    const projNavItems: NavigationItem[] = [
      { path: "projects/{key}", view: "project-tasks-view" },
    ];

    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          records: [
            pick(mockTask3Record, [
              "uid",
              "type",
              "title",
              "description",
              "project",
            ]),
          ],
        }),
      );
    });

    const checkProject = async (
      content: string,
      expected: EntityChangesetInput<"record">[],
    ) => {
      const filePath = `projects/${mockProjectRecord.key}.md`;
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, content));
      const result = throwIfError(
        await extractFileChanges(
          { ...ctx, kg },
          projNavItems,
          mockRecordSchema,
          filePath,
          "record",
          [projectView, ...mockViews],
        ),
      );
      expect(result).toEqual(expected);
    };

    const projectMarkdown = (
      description: string,
    ) => `# ${mockProjectRecord.title}

## Tasks

### ${mockTask2Record.title}

${mockTask2Record.description}

### ${mockTask3Record.title}

${mockTask3Record.description}

## Description

${description}
`;

    it("produces no mutations when content is unchanged", async () => {
      await checkProject(projectMarkdown(mockProjectRecord.description), []);
    });

    it("produces only field change when editing non-relation field", async () => {
      await checkProject(projectMarkdown("Updated project description"), [
        { uid: mockProjectUid, description: "Updated project description" },
      ]);
    });
  });

  describe("markdown with preamble", () => {
    it("propagates field-conflict when frontmatter and body diverge", async () => {
      const preambleViews = [
        mockPreambleView,
        mockPreambleStatusInBodyView,
        ...mockViews,
      ];
      const preambleNavItems: NavigationItem[] = [
        { path: "tasks/{key}", view: "task-status-body" },
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
      const result = await extractFileChanges(
        { ...ctx, kg },
        preambleNavItems,
        mockRecordSchema,
        filePath,
        "record",
        preambleViews,
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("does not produce changeset for preamble relation field absent from frontmatter", async () => {
      const preambleProjectView = createViewEntity(
        "task-preamble-project",
        `# {title}\n\n**Status:** {status}\n\n## Description\n\n{description}\n`,
        { preamble: ["status", "project"] },
      );
      const preambleViews = [preambleProjectView, ...mockViews];
      const preambleNavItems: NavigationItem[] = [
        { path: "tasks/{key}", view: "task-preamble-project" },
      ];
      const markdown = `---
status: ${mockTask2Record.status}
---

# ${mockTask2Record.title}

**Status:** ${mockTask2Record.status}

## Description

${mockTask2Record.description}
`;
      const filePath = `tasks/${mockTask2Record.key}.md`;
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, markdown));
      const result = throwIfError(
        await extractFileChanges(
          { ...ctx, kg },
          preambleNavItems,
          mockRecordSchema,
          filePath,
          "record",
          preambleViews,
        ),
      );
      expect(result).toEqual([]);
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
        [{ uid: mockTask1Uid, title: "Updated Task Title", status: "done" }],
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
        [{ uid: mockProjectUid, tasks: [["remove", mockTask3Uid]] }],
      );
    });
  });

  describe("yaml nested includes with only constraint and no range", () => {
    // `requires` is a standard field: relation, allowMultiple, no range, no inverseOf.
    // Add it to the Project type with `only: [Task]` so type is inferred from
    // the constraint when creating nested entities.
    const reqNavItems: NavigationItem[] = [
      {
        path: "projects/{key}",
        includes: {
          title: true,
          status: true,
          requires: { title: true, status: true },
        },
      },
    ];

    let schema: EntitySchema;

    beforeEach(async () => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            {
              uid: mockProjectType.uid,
              fields: [
                ...mockProjectType.fields,
                ["requires", { only: [mockTaskTypeKey] }],
              ],
            },
          ] as any,
        }),
      );
      throwIfError(
        await kg.update({
          author: "test",
          records: [{ uid: mockProjectUid, requires: [mockTask1Uid] }] as any,
        }),
      );
      schema = throwIfError(await kg.getSchema("record"));
    });

    const checkProject = async (
      content: string,
      expected: EntityChangesetInput<"record">[],
    ) => {
      const filePath = `projects/${mockProjectRecord.key}.yaml`;
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, content));
      const result = throwIfError(
        await extractFileChanges(
          { ...ctx, kg },
          reqNavItems,
          schema,
          filePath,
          "record",
          mockViews,
        ),
      );
      expect(result).toEqual(expected);
    };

    it("creates entity with type from only constraint when adding nested item", async () => {
      await checkProject(
        renderYamlEntity({
          ...pick(mockProjectRecord, ["title", "status"]),
          requires: [
            pick(mockTask1Record, ["title", "status"]),
            { title: "New task from doc", status: "pending" },
          ],
        }),
        [
          {
            uid: mockProjectUid,
            requires: [["insert", expect.any(String)]],
          },
          {
            uid: expect.any(String),
            type: mockTaskTypeKey,
            title: "New task from doc",
            status: "pending",
          },
        ],
      );
    });

    it("detects removed entry", async () => {
      await checkProject(
        renderYamlEntity({
          ...pick(mockProjectRecord, ["title", "status"]),
          requires: [],
        }),
        [{ uid: mockProjectUid, requires: [["remove", mockTask1Uid]] }],
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
          { uid: mockTask1Uid, title: "Modified Task 1" },
          { uid: mockTask2Uid, status: "done" },
        ],
      );
    });

    it("detects removal of entity from list", async () => {
      await check("all-tasks.yaml", renderYamlList([mockTask1Record]), [
        { uid: mockTask2Uid, $delete: true },
      ]);
    });
  });

  describe("create by file", () => {
    const navItemsWithWhere: NavigationItem[] = [
      {
        path: "tasks/{key}",
        where: { type: mockTaskTypeKey },
        includes: { title: true, status: true, description: true },
      },
      {
        path: "teams/{key}",
        where: { type: mockTeamTypeKey },
        includes: { key: true, members: true },
      },
    ];

    const checkCreate = async (
      filePath: string,
      content: string,
      expected: EntityChangesetInput<"record">[],
    ) => {
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, content));
      const result = throwIfError(
        await extractFileChanges(
          { ...ctx, kg },
          navItemsWithWhere,
          mockRecordSchema,
          filePath,
          "record",
          mockViews,
        ),
      );
      expect(result).toEqual(expected);
    };

    it("creates entity from where + path when entity does not exist", async () => {
      await checkCreate(
        "tasks/task-brand-new.yaml",
        renderYamlEntity({ title: "Brand New", status: "todo" }),
        [
          {
            type: mockTaskTypeKey,
            key: "task-brand-new" as EntityKey,
            title: "Brand New",
            status: "todo",
          },
        ],
      );
    });

    it("creates entity from empty file using where + path only", async () => {
      await checkCreate("teams/team-empty.yaml", "", [
        { type: mockTeamTypeKey, key: "team-empty" as EntityKey },
      ]);
    });

    it("where and path fields override content fields", async () => {
      await checkCreate(
        "tasks/task-override.yaml",
        renderYamlEntity({
          type: "Project",
          key: "wrong-key",
          title: "Override Test",
        }),
        [
          {
            type: mockTaskTypeKey,
            key: "task-override" as EntityKey,
            title: "Override Test",
          },
        ],
      );
    });

    it("still returns invalid_record_count without where", async () => {
      const noWhereNavItems: NavigationItem[] = [
        {
          path: "tasks/{key}",
          includes: { title: true, status: true, description: true },
        },
      ];
      const filePath = "tasks/task-no-where.yaml";
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(
        await ctx.fs.writeFile(
          fullPath,
          renderYamlEntity({ title: "No Where" }),
        ),
      );
      const result = await extractFileChanges(
        { ...ctx, kg },
        noWhereNavItems,
        mockRecordSchema,
        filePath,
        "record",
        mockViews,
      );
      expect(result).toBeErrWithKey("invalid_record_count");
    });

    it("still diffs against existing entity when one matches", async () => {
      await checkCreate(
        `tasks/${mockTask1Record.key}.yaml`,
        renderYamlEntity({
          title: "Updated Title",
          status: mockTask1Record.status,
          description: mockTask1Record.description,
        }),
        [{ uid: mockTask1Uid, title: "Updated Title" }],
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
        await extractModifiedFileChanges(ctx, filePath),
      );
      if (expected === null) {
        expect(result).toEqual(null);
      } else {
        expect(result).toMatchObject(expected);
      }
    };

    it("returns null when no modified files in docs folder", async () => {
      expect(
        throwIfError(
          await extractModifiedFileChanges(ctx, ctx.config.paths.docs),
        ),
      ).toEqual(null);
    });

    it("detects changes in a single modified file", async () => {
      await check(
        join(ctx.config.paths.docs, "all-tasks.yaml"),
        renderYamlList([{ ...mockTask1Record, title: "Updated Title" }]),
        {
          author: ctx.config.author,
          records: [
            { uid: mockTask1Uid, title: "Updated Title" },
            { uid: mockTask2Uid, $delete: true },
          ],
          configs: [],
        },
      );
    });

    it("detects changes when scoped to specific file", async () => {
      await check(
        join(ctx.config.paths.docs, "all-tasks.yaml"),
        renderYamlList([{ ...mockTask1Record, title: "Scoped Update" }]),
        {
          records: [
            { uid: mockTask1Uid, title: "Scoped Update" },
            { uid: mockTask2Uid, $delete: true },
          ],
        },
      );
    });

    describe("conflict detection", () => {
      it("detects conflict when two files change same entity field to different values", async () => {
        const yamlPath = join(
          ctx.config.paths.docs,
          `tasks/${mockTask1Record.key}.yaml`,
        );
        const mdPath = join(
          ctx.config.paths.docs,
          `md-tasks/${mockTask1Record.key}.md`,
        );

        throwIfError(
          await ctx.fs.mkdir(dirname(yamlPath), { recursive: true }),
        );
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

        expect(
          await extractModifiedFileChanges(ctx, ctx.config.paths.docs),
        ).toBeErrWithKey("field-conflict");
      });

      it("detects conflict when one file deletes and another updates same entity", async () => {
        const listPath = join(ctx.config.paths.docs, "all-tasks.yaml");
        const itemPath = join(
          ctx.config.paths.docs,
          `tasks/${mockTask2Record.key}.yaml`,
        );

        throwIfError(
          await ctx.fs.writeFile(listPath, renderYamlList([mockTask1Record])),
        );
        throwIfError(
          await ctx.fs.writeFile(
            itemPath,
            renderYamlEntity({
              title: "Task 2 Updated",
              status: mockTask2Record.status,
              description: mockTask2Record.description,
            }),
          ),
        );

        expect(
          await extractModifiedFileChanges(ctx, ctx.config.paths.docs),
        ).toBeErrWithKey("field-conflict");
      });
    });

    describe("cross-view changeset merge", () => {
      it("merges non-conflicting changesets for the same entity from different files", async () => {
        const yamlPath = join(
          ctx.config.paths.docs,
          `tasks/${mockTask1Record.key}.yaml`,
        );
        const mdPath = join(
          ctx.config.paths.docs,
          `md-tasks/${mockTask1Record.key}.md`,
        );

        throwIfError(
          await ctx.fs.mkdir(dirname(yamlPath), { recursive: true }),
        );
        throwIfError(await ctx.fs.mkdir(dirname(mdPath), { recursive: true }));

        throwIfError(
          await ctx.fs.writeFile(
            yamlPath,
            renderYamlEntity({
              title: mockTask1Record.title,
              status: "done",
            }),
          ),
        );

        throwIfError(
          await ctx.fs.writeFile(
            mdPath,
            `---
status: done
---

# Updated Title

## Description

Updated description
`,
          ),
        );

        const result = throwIfError(
          await extractModifiedFileChanges(ctx, ctx.config.paths.docs),
        );
        expect(result).not.toBeNull();
        const records = result!.records ?? [];
        const task1Changes = records.filter(
          (r) => "uid" in r && r.uid === mockTask1Uid,
        );
        expect(task1Changes).toEqual([
          expect.objectContaining({
            uid: mockTask1Uid,
            status: "done",
            title: "Updated Title",
            description: "Updated description",
          }),
        ]);
      });

      it("preserves non-overlapping changesets for different entities", async () => {
        const task1Path = join(
          ctx.config.paths.docs,
          `tasks/${mockTask1Record.key}.yaml`,
        );
        const task2Path = join(
          ctx.config.paths.docs,
          `tasks/${mockTask2Record.key}.yaml`,
        );

        throwIfError(
          await ctx.fs.mkdir(dirname(task1Path), { recursive: true }),
        );

        throwIfError(
          await ctx.fs.writeFile(
            task1Path,
            renderYamlEntity({
              title: "Task 1 Updated",
              status: mockTask1Record.status,
            }),
          ),
        );
        throwIfError(
          await ctx.fs.writeFile(
            task2Path,
            renderYamlEntity({
              title: "Task 2 Updated",
              status: mockTask2Record.status,
              description: mockTask2Record.description,
            }),
          ),
        );

        const result = throwIfError(
          await extractModifiedFileChanges(ctx, ctx.config.paths.docs),
        );
        expect(result).not.toBeNull();
        const records = result!.records ?? [];
        const task1Changes = records.filter(
          (r) => "uid" in r && r.uid === mockTask1Uid,
        );
        const task2Changes = records.filter(
          (r) => "uid" in r && r.uid === mockTask2Uid,
        );
        expect(task1Changes).toEqual([
          expect.objectContaining({ uid: mockTask1Uid }),
        ]);
        expect(task2Changes).toEqual([
          expect.objectContaining({ uid: mockTask2Uid }),
        ]);
      });
    });

    describe("config namespace", () => {
      it("detects changes", async () => {
        await check(
          join(ctx.config.paths.binder, "types.yaml"),
          renderYamlList([{ ...mockTaskType, name: "Updated Task Type" }]),
          {
            records: [],
            configs: expect.arrayContaining([
              { uid: mockTaskType.uid, name: "Updated Task Type" },
              { uid: mockProjectType.uid, $delete: true },
              { uid: mockUserType.uid, $delete: true },
              { uid: mockTeamType.uid, $delete: true },
            ]),
          },
        );
      });

      it("detects removal of entity from list", async () => {
        await check(
          join(ctx.config.paths.binder, "types.yaml"),
          renderYamlList([mockTaskType, mockProjectType]),
          {
            records: [],
            configs: expect.arrayContaining([
              { uid: mockUserType.uid, $delete: true },
              { uid: mockTeamType.uid, $delete: true },
            ]),
          },
        );
      });

      it("keeps key when creating entity from list", async () => {
        const newType = {
          ...mockTaskType,
          uid: "_new_type" as typeof mockTaskType.uid,
          key: "EpicType",
          name: "Epic Type",
        };

        await check(
          join(ctx.config.paths.binder, "types.yaml"),
          renderYamlList([
            mockTaskType,
            mockProjectType,
            mockUserType,
            mockTeamType,
            newType,
          ]),
          {
            records: [],
            configs: expect.arrayContaining([
              expect.objectContaining({
                type: mockTaskType.type,
                key: "EpicType",
                name: "Epic Type",
              }),
            ]),
          },
        );
      });

      it("returns null when TypeFieldRef tuples are unchanged", async () => {
        await check(
          join(ctx.config.paths.binder, "types.yaml"),
          renderYamlList([
            mockTaskType,
            mockProjectType,
            mockUserType,
            mockTeamType,
          ]),
          null,
        );
      });
    });
  });

  describe("path sanitization", () => {
    const checkSanitizedPath = async (
      taskUid: typeof mockTask1Uid,
      record: { title: string; status: string; description: string },
      navItems: NavigationItem[],
      filePath: string,
      fileContent: string,
      expected: EntityChangesetInput<"record">[],
    ) => {
      throwIfError(
        await kg.update({
          author: "test",
          records: [{ uid: taskUid, type: mockTaskTypeKey, ...record }],
        }),
      );
      const fullPath = join(ctx.config.paths.docs, filePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, fileContent));
      const result = await extractFileChanges(
        { ...ctx, kg },
        navItems,
        mockRecordSchema,
        filePath,
        "record",
        mockViews,
        undefined,
        taskUid,
      );
      expect(throwIfError(result)).toEqual(expected);
    };

    it("resolves entity when path field value contains colons", async () => {
      const taskUid = "_taskColon0" as typeof mockTask1Uid;
      await checkSanitizedPath(
        taskUid,
        { title: "1:1 Meeting", status: "pending", description: "Weekly sync" },
        [
          {
            path: "notes/{title}",
            where: { type: "Task", title: "1:1 Meeting" },
            includes: { title: true, status: true, description: true },
          },
        ],
        "notes/1-1 Meeting.yaml",
        renderYamlEntity({
          title: "1:1 Meeting",
          status: "done",
          description: "Weekly sync",
        }),
        [{ uid: taskUid, status: "done" }],
      );
    });

    it("resolves entity when path field value contains multiple special chars", async () => {
      const taskUid = "_taskSpecCh" as typeof mockTask1Uid;
      await checkSanitizedPath(
        taskUid,
        {
          title: 'Q&A: "Why?" <explained>',
          status: "pending",
          description: "Special chars test",
        },
        [
          {
            path: "notes/{title}",
            where: { type: "Task", title: 'Q&A: "Why?" <explained>' },
            includes: { title: true, status: true, description: true },
          },
        ],
        "notes/Q&A- -Why-- -explained-.yaml",
        renderYamlEntity({
          title: 'Q&A: "Why?" <explained>',
          status: "done",
          description: "Special chars test",
        }),
        [{ uid: taskUid, status: "done" }],
      );
    });

    it("resolves entity for markdown files with sanitized path", async () => {
      const taskUid = "_taskSanMd0" as typeof mockTask1Uid;
      await checkSanitizedPath(
        taskUid,
        {
          title: "Design: Phase 1",
          status: "pending",
          description: "First phase",
        },
        [
          {
            path: "tasks/{title}",
            where: { type: "Task", title: "Design: Phase 1" },
            view: "task-view",
          },
        ],
        "tasks/Design- Phase 1.md",
        taskMarkdown("Design: Phase 1", "done", "First phase"),
        [{ uid: taskUid, status: "done" }],
      );
    });

    it("returns no changes when sanitized path file is unchanged", async () => {
      const taskUid = "_taskNoCh00" as typeof mockTask1Uid;
      await checkSanitizedPath(
        taskUid,
        {
          title: "Topic: Overview",
          status: "pending",
          description: "Summary",
        },
        [
          {
            path: "notes/{title}",
            where: { type: "Task", title: "Topic: Overview" },
            includes: { title: true, status: true, description: true },
          },
        ],
        "notes/Topic- Overview.yaml",
        renderYamlEntity({
          title: "Topic: Overview",
          status: "pending",
          description: "Summary",
        }),
        [],
      );
    });

    it("still works for paths without sanitized characters", async () => {
      await check(
        `tasks/${mockTask1Record.key}.yaml`,
        renderYamlEntity({
          title: "Updated Title",
          status: mockTask1Record.status,
          description: mockTask1Record.description,
        }),
        [{ uid: mockTask1Uid, title: "Updated Title" }],
      );
    });
  });
});

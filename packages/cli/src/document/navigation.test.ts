import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { omit, throwIfError } from "@binder/utils";
import {
  openKnowledgeGraph,
  type ConfigKey,
  type EntitySchema,
  type EntityKey,
  type Fieldset,
  type FieldsetNested,
  type GraphVersion,
  type KnowledgeGraph,
} from "@binder/repo";
import {
  mockRecordSchema,
  mockProjectKey,
  mockProjectRecord,
  mockProjectUid,
  mockTask1Record,
  mockTask2Record,
  mockTaskTypeKey,
  mockTransactionInit,
} from "@binder/repo/mocks";
import type { DatabaseCli } from "../db";
import { getTestDatabaseCli } from "../db/db.mock.ts";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "../lib/filesystem.mock.ts";
import {
  createMockRuntimeContextWithDb,
  mockConfig,
  mockLog,
} from "../runtime.mock.ts";
import { BINDER_DIR } from "../config.ts";
import { cliConfigSchema, typeViewKey } from "../cli-config-schema.ts";
import { parseView, renderViewAst } from "./view.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  findEntityLocation,
  findNavigationItemByPath,
  findView,
  getNavigationFilePatterns,
  loadNavigation,
  type NavigationItem,
  renderNavigation,
  renderNavigationItem,
} from "./navigation.ts";
import { mockNavigationConfigInput } from "./navigation.mock.ts";
import { DOCUMENT_VIEW_KEY, loadViews, type Views } from "./view-entity.ts";
import { mockViews } from "./view.mock.ts";

/** Reorder fieldset so tags comes after key (matching dbModelToEntity order) */
const reorderTagsField = (fieldset: Fieldset): Fieldset => {
  const { tags, ...rest } = fieldset;
  if (tags === undefined) return fieldset;
  const { uid, key, ...fields } = rest;
  return { uid, key, tags, ...fields } as Fieldset;
};

describe("navigation", () => {
  describe("findNavigationItemByPath", () => {
    const check = (
      items: NavigationItem[],
      path: string,
      expected: NavigationItem | undefined,
    ) => {
      const result = findNavigationItemByPath(items, path);
      expect(result).toEqual(expected);
    };

    it("matches markdown file by path pattern", () => {
      const item: NavigationItem = {
        path: "tasks/{title}",
        view: DOCUMENT_VIEW_KEY,
      };
      check([item], "tasks/my-task.md", item);
    });

    it("matches yaml file by path pattern", () => {
      const item: NavigationItem = {
        path: "all-tasks",
        query: { filters: { type: "Task" } },
      };
      check([item], "all-tasks.yaml", item);
    });

    it("returns undefined when no match found", () => {
      const item: NavigationItem = {
        path: "tasks/{title}",
        view: DOCUMENT_VIEW_KEY,
      };
      check([item], "projects/my-project.md", undefined);
    });

    it("returns first matching item", () => {
      const first: NavigationItem = {
        path: "tasks/{title}",
        view: DOCUMENT_VIEW_KEY,
      };
      check(
        [first, { path: "tasks/{key}", view: DOCUMENT_VIEW_KEY }],
        "tasks/my-task.md",
        first,
      );
    });

    it("prefers a more specific rule over a less specific sibling", () => {
      const outer: NavigationItem = {
        path: "tasks/{priority} {key}",
        view: DOCUMENT_VIEW_KEY,
      };
      const inner: NavigationItem = {
        path: "tasks/backlog/{priority} {key}",
        view: DOCUMENT_VIEW_KEY,
      };
      // Outer rule's `{priority}` must not greedily consume `backlog/p2`.
      // The inner rule is the correct match regardless of declaration order.
      check([outer, inner], "tasks/backlog/p2 new-task.md", inner);
      check([inner, outer], "tasks/backlog/p2 new-task.md", inner);
      // Outer still matches its own paths.
      check([outer, inner], "tasks/p2 new-task.md", outer);
    });

    it("matches nested child item", () => {
      const childItem: NavigationItem = {
        path: "info",
        view: DOCUMENT_VIEW_KEY,
      };
      check(
        [{ path: "tasks/{title}/", children: [childItem] }],
        "tasks/my-task/info.md",
        childItem,
      );
    });

    it("matches deeply nested child", () => {
      const deepChild: NavigationItem = {
        path: "details",
        query: { filters: { type: "Detail" } },
      };
      check(
        [
          {
            path: "projects/",
            children: [{ path: "tasks/", children: [deepChild] }],
          },
        ],
        "projects/tasks/details.yaml",
        deepChild,
      );
    });

    it("matches config file", () => {
      check(
        CONFIG_NAVIGATION_ITEMS,
        `${BINDER_DIR}/fields.yaml`,
        CONFIG_NAVIGATION_ITEMS[0],
      );
    });
  });

  describe("renderNavigation", () => {
    let db: DatabaseCli;
    let kg: KnowledgeGraph;
    let fs: MockFileSystem;
    let defaultViewContent: string;
    const paths = mockConfig.paths;
    const docsPath = mockConfig.paths.docs;

    const staticViewContent = "# Welcome\n\nStatic content\n";
    const infoViewContent = "# Info\n\n{description}";

    beforeEach(async () => {
      db = getTestDatabaseCli();
      kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));

      const views = throwIfError(await loadViews(kg));
      defaultViewContent = findView(views, DOCUMENT_VIEW_KEY).viewContent;

      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            {
              type: typeViewKey,
              key: "static-view" as ConfigKey,
              viewContent: staticViewContent,
            },
            {
              type: typeViewKey,
              key: "info-view" as ConfigKey,
              viewContent: infoViewContent,
            },
          ],
        }),
      );
    });

    type FileSpec =
      | { path: string; view?: string; data: Fieldset }
      | { path: string; content: string }
      | { path: string; yaml: FieldsetNested }
      | { path: string; yamlList: FieldsetNested[] };

    const check = async (
      navigationItems: NavigationItem[],
      files: FileSpec[],
    ) => {
      const views = throwIfError(await loadViews(kg));
      throwIfError(
        await renderNavigation(
          { db, kg, fs, paths, namespace: "record", views, log: mockLog },
          navigationItems,
        ),
      );

      for (const file of files) {
        const fileContent = throwIfError(
          await fs.readFile(`${docsPath}/${file.path}`),
        );

        if ("yaml" in file) {
          expect(fileContent).toEqual(renderYamlEntity(file.yaml));
        } else if ("yamlList" in file) {
          expect(fileContent).toEqual(renderYamlList(file.yamlList));
        } else if ("content" in file) {
          expect(fileContent).toEqual(file.content);
        } else {
          const viewAst = parseView(file.view ?? defaultViewContent);
          const snapshot = throwIfError(
            renderViewAst(mockRecordSchema, mockViews, viewAst, file.data),
          );
          expect(fileContent).toEqual(snapshot);
        }
      }

      const generatedFiles = Array.from(fs.files.keys()).filter(
        (f) => f.endsWith(".md") || f.endsWith(".yaml"),
      );
      expect(generatedFiles).toEqual(files.map((f) => `${docsPath}/${f.path}`));
    };

    const createRenderCtx = async () => {
      const views = throwIfError(await loadViews(kg));
      return {
        db,
        kg,
        fs,
        paths,
        namespace: "record" as const,
        views,
        log: mockLog,
      };
    };

    it("renders simple markdown without iteration", async () => {
      await check(
        [{ path: "README", view: "static-view" }],
        [{ path: "README.md", content: staticViewContent }],
      );
    });

    it("renders nested item for directory", async () => {
      await check(
        [
          {
            path: "tasks/{title}/",
            where: { type: "Task" },
            children: [
              {
                path: "info",
                view: "info-view",
              },
            ],
          },
        ],
        [
          {
            path: `tasks/${mockTask1Record.title}/info.md`,
            view: infoViewContent,
            data: mockTask1Record,
          },
          {
            path: `tasks/${mockTask2Record.title}/info.md`,
            view: infoViewContent,
            data: mockTask2Record,
          },
        ],
      );
    });

    it("renders nested query with context interpolation", async () => {
      await check(
        [
          {
            path: "projects/{title}/",
            where: { type: "Project" },
            children: [
              {
                path: "tasks",
                query: { filters: { type: "Task", project: "{uid}" } },
              },
            ],
          },
        ],
        [
          {
            path: `projects/${mockProjectRecord.title}/tasks.yaml`,
            yamlList: [
              omit({ ...mockTask2Record, project: mockProjectKey }, [
                "id",
                "type",
                "uid",
              ]),
            ],
          },
        ],
      );
    });

    it("renders nested item", async () => {
      await check(
        [
          {
            path: "projects/{title}/",
            where: { type: "Project" },
            children: [
              {
                path: "{parent.uid}",
                view: DOCUMENT_VIEW_KEY,
              },
            ],
          },
        ],
        [
          {
            path: `projects/${mockProjectRecord.title}/${mockProjectRecord.uid}.md`,
            data: mockProjectRecord,
          },
        ],
      );
    });

    it("returns rendered and modified paths on first render", async () => {
      const ctx = await createRenderCtx();
      const result = throwIfError(
        await renderNavigation(ctx, [{ path: "README", view: "static-view" }]),
      );

      expect(result).toEqual({
        renderedPaths: ["README.md"],
        modifiedPaths: ["README.md"],
        divergedPaths: [],
        errors: [],
      });
    });

    it("returns empty modifiedPaths when content unchanged", async () => {
      const ctx = await createRenderCtx();
      const navigationItems: NavigationItem[] = [
        { path: "README", view: "static-view" },
      ];

      throwIfError(await renderNavigation(ctx, navigationItems));
      const result = throwIfError(await renderNavigation(ctx, navigationItems));

      expect(result).toEqual({
        renderedPaths: ["README.md"],
        modifiedPaths: [],
        divergedPaths: [],
        errors: [],
      });
    });
  });

  describe("renderNavigationItem", () => {
    let db: DatabaseCli;
    let kg: KnowledgeGraph;
    let fs: MockFileSystem;
    let schema: EntitySchema;
    let version: GraphVersion;
    let views: Views;
    const paths = mockConfig.paths;
    const docsPath = mockConfig.paths.docs;

    beforeEach(async () => {
      db = getTestDatabaseCli();
      kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));

      schema = throwIfError(await kg.getSchema("record"));
      version = throwIfError(await kg.version());
      views = throwIfError(await loadViews(kg));
    });

    const addView = async (
      key: string,
      viewContent: string,
      options?: Record<string, unknown>,
    ) => {
      throwIfError(
        await kg.update({
          author: "test",
          configs: [
            {
              type: typeViewKey,
              key: key as ConfigKey,
              viewContent,
              ...options,
            },
          ],
        }),
      );
      views = throwIfError(await loadViews(kg));
    };

    type RenderItemOptions = {
      parentPath?: string;
      parentEntities?: Fieldset[];
      log?: typeof mockLog;
    };

    const renderItem = async (
      item: NavigationItem,
      options: RenderItemOptions = {},
    ) => {
      const { parentPath = "", parentEntities = [], log = mockLog } = options;
      return throwIfError(
        await renderNavigationItem(
          {
            db,
            kg,
            fs,
            paths,
            schema,
            version,
            namespace: "record",
            views,
            log,
          },
          item,
          parentPath,
          parentEntities,
        ),
      );
    };

    const check = async (
      item: NavigationItem,
      expectedPath: string,
      expectedContent: string,
      options: RenderItemOptions = {},
    ) => {
      await renderItem(item, options);
      const content = throwIfError(
        await fs.readFile(`${docsPath}/${expectedPath}`),
      );
      expect(content).toBe(expectedContent);
    };

    describe("markdown rendering", () => {
      it("renders with local fields only", async () => {
        await addView("local-view", "# {title}\n\n{description}\n");
        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task" },
            view: "local-view",
          },
          `tasks/${mockTask1Record.title}.md`,
          `# ${mockTask1Record.title}\n\n${mockTask1Record.description}\n`,
        );
      });

      it("renders with nested relationship field", async () => {
        await addView("nested-view", "# {title}\n\nProject: {project.title}\n");
        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task" },
            view: "nested-view",
          },
          `tasks/${mockTask2Record.title}.md`,
          `# ${mockTask2Record.title}\n\nProject: ${mockProjectRecord.title}\n`,
        );
      });

      it("renders with includes and nested field in view", async () => {
        await addView(
          "task-with-project",
          "# {title}\n\nProject: {project.title}\n",
        );
        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task" },
            includes: { project: true },
            view: "task-with-project",
          },
          `tasks/${mockTask2Record.title}.md`,
          `# ${mockTask2Record.title}\n\nProject: ${mockProjectRecord.title}\n`,
        );
      });

      it("renders with frontmatter when view has preamble", async () => {
        await addView("task-preamble", "# {title}\n\n{description}\n", {
          preamble: ["status"],
        });

        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task" },
            view: "task-preamble",
          },
          `tasks/${mockTask1Record.title}.md`,
          `---\nstatus: ${mockTask1Record.status}\n---\n\n# ${mockTask1Record.title}\n\n${mockTask1Record.description}\n`,
        );
      });

      it("renders without frontmatter when preamble fields are all null", async () => {
        await addView("task-no-fm", "# {title}\n", {
          preamble: ["nonExistentField"],
        });

        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task" },
            view: "task-no-fm",
          },
          `tasks/${mockTask1Record.title}.md`,
          `# ${mockTask1Record.title}\n`,
        );
      });

      it("renders frontmatter with key instead of UID for relation fields", async () => {
        await addView("task-ref-preamble", "# {title}\n", {
          preamble: ["project"],
        });

        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task", project: mockProjectUid },
            view: "task-ref-preamble",
          },
          `tasks/${mockTask2Record.title}.md`,
          `---\nproject: ${mockProjectKey}\n---\n\n# ${mockTask2Record.title}\n`,
        );
      });

      it("renders view body with key instead of UID for relation fields", async () => {
        await addView("task-ref-body", "# {title}\n\nProject: {project}\n");

        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task", project: mockProjectUid },
            view: "task-ref-body",
          },
          `tasks/${mockTask2Record.title}.md`,
          `# ${mockTask2Record.title}\n\nProject: ${mockProjectKey}\n`,
        );
      });

      it("renders with ancestral field in path", async () => {
        await addView("task-detail", "# {title}\n");
        await check(
          {
            path: "tasks/{title}",
            where: { type: "Task", project: "{parent.uid}" },
            view: "task-detail",
          },
          `projects/${mockProjectRecord.title}/tasks/${mockTask2Record.title}.md`,
          `# ${mockTask2Record.title}\n`,
          {
            parentPath: `projects/${mockProjectRecord.title}/`,
            parentEntities: [mockProjectRecord],
          },
        );
      });
    });

    describe("yaml rendering", () => {
      it("renders entity", async () => {
        await check(
          {
            path: "projects/{title}",
            where: { type: "Project" },
          },
          `projects/${mockProjectRecord.title}.yaml`,
          renderYamlEntity(omit(mockProjectRecord, ["id", "type"])),
        );
      });

      it("renders query", async () => {
        await check(
          {
            path: "all-tasks",
            query: { filters: { type: "Task" } },
          },
          "all-tasks.yaml",
          renderYamlList([
            reorderTagsField(omit(mockTask1Record, ["id", "type", "uid"])),
            reorderTagsField(
              omit({ ...mockTask2Record, project: mockProjectKey }, [
                "id",
                "type",
                "uid",
              ]),
            ),
          ]),
        );
      });

      it("renders query with nested relationship field", async () => {
        await check(
          {
            path: "tasks-with-project",
            query: {
              filters: { type: "Task", project: mockProjectRecord.uid },
              includes: { project: true },
            },
          },
          "tasks-with-project.yaml",
          renderYamlList([{ project: mockProjectKey }]),
        );
      });
    });

    describe("path field handling", () => {
      it("skips entity when a path field value is null and logs warning", async () => {
        const warnings: string[] = [];
        const result = await renderItem(
          { path: "tasks/{project}", where: { type: "Task" } },
          {
            log: {
              ...mockLog,
              warn: (msg: string) => warnings.push(msg),
            },
          },
        );

        expect(result.renderedPaths).toEqual([`tasks/${mockProjectUid}.yaml`]);
        expect(warnings).toEqual([
          expect.stringContaining("missing value for path field 'project'"),
        ]);

        const generatedFiles = Array.from(fs.files.keys()).filter((f) =>
          f.endsWith(".yaml"),
        );
        expect(generatedFiles).toEqual([
          `${docsPath}/tasks/${mockProjectUid}.yaml`,
        ]);
      });

      it("skips entity when any field in a multi-field path is null", async () => {
        const result = await renderItem({
          path: "tasks/{project}/{key}",
          where: { type: "Task" },
        });

        expect(result.renderedPaths).toEqual([
          `tasks/${mockProjectUid}/${mockTask2Record.key}.yaml`,
        ]);
      });
    });

    describe("result limits", () => {
      it("renders all results when limit is not specified", async () => {
        const result = await renderItem({
          path: "tasks/{title}",
          where: { type: "Task" },
        });
        expect(result.renderedPaths).toEqual([
          `tasks/${mockTask1Record.title}.yaml`,
          `tasks/${mockTask2Record.title}.yaml`,
        ]);
      });

      it("renders all results when count exceeds old default limit of 50", async () => {
        const totalTasks = 55;
        const records = Array.from({ length: totalTasks }, (_, i) => ({
          type: mockTaskTypeKey,
          key: `bulk-task-${String(i).padStart(3, "0")}` as EntityKey,
          title: `Bulk Task ${String(i).padStart(3, "0")}`,
          status: "pending",
        }));
        throwIfError(await kg.update({ author: "test", records }));

        const result = await renderItem({
          path: "tasks/{title}",
          where: { type: "Task" },
        });

        expect(result.renderedPaths.length).toBe(2 + totalTasks);
      });

      it("renders only limited number of results when limit is set", async () => {
        const result = await renderItem({
          path: "tasks/{title}",
          where: { type: "Task" },
          limit: 1,
        });
        expect(result.renderedPaths).toEqual([
          `tasks/${mockTask1Record.title}.yaml`,
        ]);
      });

      it("does not log warning when all results fit within default limit", async () => {
        const warnings: string[] = [];
        await renderItem(
          { path: "tasks/{title}", where: { type: "Task" } },
          {
            log: {
              ...mockLog,
              warn: (msg: string) => warnings.push(msg),
            },
          },
        );

        expect(warnings).toEqual([]);
      });
    });

    describe("multi-value path fan-out", () => {
      type UpdateRecords = NonNullable<
        Parameters<KnowledgeGraph["update"]>[0]["records"]
      >;

      const checkPaths = async (
        item: NavigationItem,
        expectedPaths: string[],
        opts: {
          records?: UpdateRecords;
          expectedWarnings?: string[];
        } = {},
      ) => {
        if (opts.records) {
          throwIfError(
            await kg.update({ author: "test", records: opts.records }),
          );
        }
        const warnings: string[] = [];
        const log = {
          ...mockLog,
          warn: (msg: string) => warnings.push(msg),
        };
        const result = await renderItem(item, { log });
        expect(result.renderedPaths.sort()).toEqual([...expectedPaths].sort());
        if (opts.expectedWarnings !== undefined) {
          expect(warnings).toEqual(
            opts.expectedWarnings.map((w) => expect.stringContaining(w)),
          );
        }
      };

      it("renders one path per value for a multi-value path field", async () => {
        await checkPaths(
          {
            path: "by-tag/{tags}/{key}",
            where: { type: "Task", key: mockTask1Record.key },
          },
          [
            `by-tag/important/${mockTask1Record.key}.yaml`,
            `by-tag/urgent/${mockTask1Record.key}.yaml`,
          ],
        );
      });

      it("skips entity with empty multi-value field and logs missing-field warn", async () => {
        await checkPaths(
          {
            path: "by-tag/{tags}/{key}",
            where: { type: "Task", key: mockTask1Record.key },
          },
          [],
          {
            records: [{ uid: mockTask1Record.uid, tags: [] }],
            expectedWarnings: ["missing value for path field 'tags'"],
          },
        );
      });

      it("narrows multi-value field for child navigation paths", async () => {
        await checkPaths(
          {
            path: "by-tag/{tags}/",
            where: { type: "Task", key: mockTask1Record.key },
            children: [{ path: "{parent.tags}" }],
          },
          ["by-tag/important/important.yaml", "by-tag/urgent/urgent.yaml"],
        );
      });
    });
  });

  describe("loadNavigation", () => {
    let kg: KnowledgeGraph;

    beforeEach(async () => {
      const ctx = await createMockRuntimeContextWithDb();
      kg = ctx.kg;
      throwIfError(
        await kg.update({
          author: "test",
          configs: mockNavigationConfigInput,
        }),
      );
    });

    it("loads navigation tree from config namespace", async () => {
      const result = throwIfError(await loadNavigation(kg));
      expect(result).toEqual([
        {
          path: "projects/{title}/",
          where: { type: "Project" },
          children: [
            {
              path: "tasks",
              query: { filters: { type: "Task", project: "{uid}" } },
            },
          ],
        },
        {
          path: "all-tasks",
          query: { filters: { type: "Task" } },
        },
        {
          path: "tasks/{key}",
          where: { type: "Task" },
          includes: { title: true, status: true, project: true },
        },
        {
          path: "md-tasks/{key}",
          where: { type: "Task" },
          view: "md-task-view",
        },
        {
          path: "limited-tasks/{key}",
          where: { type: "Task" },
          limit: 10,
        },
      ]);
    });
  });

  describe("findEntityLocation", () => {
    const schema = mockRecordSchema;
    let fs: MockFileSystem;
    const paths = mockConfig.paths;

    beforeEach(async () => {
      fs = createInMemoryFileSystem();
      await fs.mkdir(paths.root);
      await fs.mkdir(paths.binder);
      await fs.mkdir(paths.docs);
    });

    it("returns undefined when no matching nav item found", async () => {
      const result = throwIfError(
        await findEntityLocation(fs, paths, schema, mockTask1Record, []),
      );
      expect(result).toBeUndefined();
    });

    it("finds individual file for entity with matching where filter", async () => {
      const navigation: NavigationItem[] = [
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          view: DOCUMENT_VIEW_KEY,
        },
      ];

      const result = throwIfError(
        await findEntityLocation(
          fs,
          paths,
          schema,
          mockTask1Record,
          navigation,
        ),
      );
      expect(result).toEqual({
        filePath: `${paths.docs}/tasks/${mockTask1Record.title}.md`,
        line: 0,
      });
    });

    it("finds entity in list file", async () => {
      const navigation: NavigationItem[] = [
        {
          path: "all-tasks",
          query: { filters: { type: "Task" } },
        },
      ];

      const listContent = [
        "- key: first-key",
        "  title: First Task",
        "- key: second-key",
        "  title: Second Task",
      ].join("\n");
      await fs.writeFile(`${paths.docs}/all-tasks.yaml`, listContent);

      const firstEntity: Fieldset = { type: "Task", key: "first-key" };
      const secondEntity: Fieldset = { type: "Task", key: "second-key" };

      const result = throwIfError(
        await findEntityLocation(fs, paths, schema, firstEntity, navigation),
      );
      expect(result).toEqual({
        filePath: `${paths.docs}/all-tasks.yaml`,
        line: 0,
      });

      const result2 = throwIfError(
        await findEntityLocation(fs, paths, schema, secondEntity, navigation),
      );
      expect(result2).toEqual({
        filePath: `${paths.docs}/all-tasks.yaml`,
        line: 2,
      });
    });

    it("prefers individual file over list file", async () => {
      const navigation: NavigationItem[] = [
        {
          path: "all-tasks",
          query: { filters: { type: "Task" } },
        },
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          view: DOCUMENT_VIEW_KEY,
        },
      ];

      const result = throwIfError(
        await findEntityLocation(
          fs,
          paths,
          schema,
          mockTask1Record,
          navigation,
        ),
      );
      expect(result).toEqual({
        filePath: `${paths.docs}/tasks/${mockTask1Record.title}.md`,
        line: 0,
      });
    });
  });

  describe("getNavigationFilePatterns", () => {
    it("converts path views to glob patterns", () => {
      expect(
        getNavigationFilePatterns([
          { path: "tasks/{title}", view: DOCUMENT_VIEW_KEY },
          { path: "projects/{parent.title}/{uid}", view: DOCUMENT_VIEW_KEY },
          { path: "static/file", view: DOCUMENT_VIEW_KEY },
          { path: "dirs/{name}/" },
        ]),
      ).toEqual(["tasks/*.md", "projects/*/*.md", "static/file.md", "dirs/*/"]);
    });
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { omit, throwIfError } from "@binder/utils";
import {
  openKnowledgeGraph,
  type ConfigKey,
  type EntitySchema,
  type Fieldset,
  type FieldsetNested,
  type GraphVersion,
  type KnowledgeGraph,
} from "@binder/db";
import {
  mockNodeSchema,
  mockProjectKey,
  mockProjectNode,
  mockTask1Node,
  mockTask2Node,
  mockTransactionInit,
} from "@binder/db/mocks";
import type { DatabaseCli } from "../db";
import { getTestDatabaseCli } from "../db/db.mock.ts";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "../lib/filesystem.mock.ts";
import { createMockRuntimeContextWithDb, mockConfig } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { BINDER_DIR } from "../config.ts";
import { cliConfigSchema, typeTemplateKey } from "../cli-config-schema.ts";
import { parseTemplate, renderTemplate } from "./template.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  findEntityLocation,
  findNavigationItemByPath,
  findTemplate,
  getNavigationFilePatterns,
  loadNavigation,
  type NavigationItem,
  renderNavigation,
  renderNavigationItem,
} from "./navigation.ts";
import { mockNavigationConfigInput } from "./navigation.mock.ts";
import {
  DEFAULT_TEMPLATE_KEY,
  loadTemplates,
  type Templates,
} from "./template-entity.ts";

describe("navigation", () => {
  const schema = mockNodeSchema;

  describe("findNavigationItemByPath", () => {
    const check = (
      items: NavigationItem[],
      path: string,
      expected: NavigationItem | undefined,
    ) => {
      const result = findNavigationItemByPath(items, path);
      expect(result).toEqual(expected);
    };

    it("matches markdown file by path template", () => {
      const item: NavigationItem = {
        path: "tasks/{title}",
        template: DEFAULT_TEMPLATE_KEY,
      };
      check([item], "tasks/my-task.md", item);
    });

    it("matches yaml file by path template", () => {
      const item: NavigationItem = {
        path: "all-tasks",
        query: { filters: { type: "Task" } },
      };
      check([item], "all-tasks.yaml", item);
    });

    it("returns undefined when no match found", () => {
      const item: NavigationItem = {
        path: "tasks/{title}",
        template: DEFAULT_TEMPLATE_KEY,
      };
      check([item], "projects/my-project.md", undefined);
    });

    it("returns first matching item", () => {
      const first: NavigationItem = {
        path: "tasks/{title}",
        template: DEFAULT_TEMPLATE_KEY,
      };
      check(
        [first, { path: "tasks/{key}", template: DEFAULT_TEMPLATE_KEY }],
        "tasks/my-task.md",
        first,
      );
    });

    it("matches nested child item", () => {
      const childItem: NavigationItem = {
        path: "info",
        template: DEFAULT_TEMPLATE_KEY,
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
    let defaultTemplateContent: string;
    const paths = mockConfig.paths;
    const docsPath = mockConfig.paths.docs;

    const staticViewContent = "# Welcome\n\nStatic content\n";
    const infoViewContent = "# Info\n\n{description}";

    beforeEach(async () => {
      db = getTestDatabaseCli();
      kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));

      const templates = throwIfError(await loadTemplates(kg));
      defaultTemplateContent = findTemplate(
        templates,
        DEFAULT_TEMPLATE_KEY,
      ).templateContent;

      throwIfError(
        await kg.update({
          author: "test",
          configurations: [
            {
              type: typeTemplateKey,
              key: "static-template" as ConfigKey,
              templateContent: staticViewContent,
            },
            {
              type: typeTemplateKey,
              key: "info-template" as ConfigKey,
              templateContent: infoViewContent,
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
      const templates = throwIfError(await loadTemplates(kg));
      throwIfError(
        await renderNavigation(db, kg, fs, paths, navigationItems, templates),
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
          const viewAst = parseTemplate(file.view ?? defaultTemplateContent);
          const snapshot = throwIfError(
            renderTemplate(mockNodeSchema, viewAst, file.data),
          );
          expect(fileContent).toEqual(snapshot);
        }
      }

      const generatedFiles = Array.from(fs.files.keys()).filter(
        (f) => f.endsWith(".md") || f.endsWith(".yaml"),
      );
      expect(generatedFiles).toEqual(files.map((f) => `${docsPath}/${f.path}`));
    };

    it("renders simple markdown without iteration", async () => {
      await check(
        [{ path: "README", template: "static-template" }],
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
                template: "info-template",
              },
            ],
          },
        ],
        [
          {
            path: `tasks/${mockTask1Node.title}/info.md`,
            view: infoViewContent,
            data: mockTask1Node,
          },
          {
            path: `tasks/${mockTask2Node.title}/info.md`,
            view: infoViewContent,
            data: mockTask2Node,
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
            path: `projects/${mockProjectNode.title}/tasks.yaml`,
            yamlList: [
              omit({ ...mockTask2Node, project: mockProjectKey }, [
                "id",
                "type",
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
                template: DEFAULT_TEMPLATE_KEY,
              },
            ],
          },
        ],
        [
          {
            path: `projects/${mockProjectNode.title}/${mockProjectNode.uid}.md`,
            data: mockProjectNode,
          },
        ],
      );
    });

    it("returns rendered and modified paths on first render", async () => {
      const templates = throwIfError(await loadTemplates(kg));
      const result = throwIfError(
        await renderNavigation(
          db,
          kg,
          fs,
          paths,
          [{ path: "README", template: "static-template" }],
          templates,
        ),
      );

      expect(result).toEqual({
        renderedPaths: ["README.md"],
        modifiedPaths: ["README.md"],
      });
    });

    it("returns empty modifiedPaths when content unchanged", async () => {
      const templates = throwIfError(await loadTemplates(kg));
      const navigationItems: NavigationItem[] = [
        { path: "README", template: "static-template" },
      ];

      throwIfError(
        await renderNavigation(db, kg, fs, paths, navigationItems, templates),
      );

      const result = throwIfError(
        await renderNavigation(db, kg, fs, paths, navigationItems, templates),
      );

      expect(result).toEqual({
        renderedPaths: ["README.md"],
        modifiedPaths: [],
      });
    });
  });

  describe("renderNavigationItem", () => {
    let db: DatabaseCli;
    let kg: KnowledgeGraph;
    let fs: MockFileSystem;
    let schema: EntitySchema;
    let version: GraphVersion;
    let templates: Templates;
    const paths = mockConfig.paths;
    const docsPath = mockConfig.paths.docs;

    beforeEach(async () => {
      db = getTestDatabaseCli();
      kg = openKnowledgeGraph(db, { configSchema: cliConfigSchema });
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));

      schema = throwIfError(await kg.getSchema("node"));
      version = throwIfError(await kg.version());
      templates = throwIfError(await loadTemplates(kg));
    });

    const addTemplate = async (key: string, templateContent: string) => {
      throwIfError(
        await kg.update({
          author: "test",
          configurations: [
            { type: typeTemplateKey, key: key as ConfigKey, templateContent },
          ],
        }),
      );
      templates = throwIfError(await loadTemplates(kg));
    };

    type CheckOptions = {
      parentPath?: string;
      parentEntities?: Fieldset[];
    };

    const check = async (
      item: NavigationItem,
      expectedPath: string,
      expectedContent: string,
      options: CheckOptions = {},
    ) => {
      const { parentPath = "", parentEntities = [] } = options;
      throwIfError(
        await renderNavigationItem(
          db,
          kg,
          fs,
          paths,
          schema,
          version,
          item,
          parentPath,
          parentEntities,
          "node",
          templates,
        ),
      );
      const content = throwIfError(
        await fs.readFile(`${docsPath}/${expectedPath}`),
      );
      expect(content).toBe(expectedContent);
    };

    it("renders markdown with local fields only", async () => {
      await addTemplate("local-template", "# {title}\n\n{description}\n");
      await check(
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          template: "local-template",
        },
        `tasks/${mockTask1Node.title}.md`,
        `# ${mockTask1Node.title}\n\n${mockTask1Node.description}\n`,
      );
    });

    it("renders markdown with nested relationship field", async () => {
      await addTemplate(
        "nested-template",
        "# {title}\n\nProject: {project.title}\n",
      );
      await check(
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          template: "nested-template",
        },
        `tasks/${mockTask2Node.title}.md`,
        `# ${mockTask2Node.title}\n\nProject: ${mockProjectNode.title}\n`,
      );
    });

    it("renders yaml entity", async () => {
      await check(
        {
          path: "projects/{title}",
          where: { type: "Project" },
        },
        `projects/${mockProjectNode.title}.yaml`,
        renderYamlEntity(omit(mockProjectNode, ["id", "type"])),
      );
    });

    it("renders yaml query", async () => {
      await check(
        {
          path: "all-tasks",
          query: { filters: { type: "Task" } },
        },
        "all-tasks.yaml",
        renderYamlList([
          omit(mockTask1Node, ["id", "type"]),
          omit({ ...mockTask2Node, project: mockProjectKey }, ["id", "type"]),
        ]),
      );
    });

    it("renders yaml query with nested relationship field", async () => {
      await check(
        {
          path: "tasks-with-project",
          query: {
            filters: { type: "Task", project: mockProjectNode.uid },
            includes: { project: true },
          },
        },
        "tasks-with-project.yaml",
        renderYamlList([{ project: mockProjectKey }]),
      );
    });

    it("renders markdown with includes in navigation item and nested field in template", async () => {
      await addTemplate(
        "task-with-project",
        "# {title}\n\nProject: {project.title}\n",
      );
      await check(
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          includes: { project: true },
          template: "task-with-project",
        },
        `tasks/${mockTask2Node.title}.md`,
        `# ${mockTask2Node.title}\n\nProject: ${mockProjectNode.title}\n`,
      );
    });

    it("renders markdown with ancestral field in path", async () => {
      await addTemplate("task-detail", "# {title}\n");
      await check(
        {
          path: "tasks/{title}",
          where: { type: "Task", project: "{parent.uid}" },
          template: "task-detail",
        },
        `projects/${mockProjectNode.title}/tasks/${mockTask2Node.title}.md`,
        `# ${mockTask2Node.title}\n`,
        {
          parentPath: `projects/${mockProjectNode.title}/`,
          parentEntities: [mockProjectNode],
        },
      );
    });
  });

  describe("loadNavigation", () => {
    let ctx: RuntimeContextWithDb;
    let kg: KnowledgeGraph;

    beforeEach(async () => {
      ctx = await createMockRuntimeContextWithDb();
      kg = ctx.kg;
      throwIfError(
        await kg.update({
          author: "test",
          configurations: mockNavigationConfigInput,
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
      ]);
    });
  });

  describe("findEntityLocation", () => {
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
        await findEntityLocation(fs, paths, schema, mockTask1Node, []),
      );
      expect(result).toBeUndefined();
    });

    it("finds individual file for entity with matching where filter", async () => {
      const navigation: NavigationItem[] = [
        {
          path: "tasks/{title}",
          where: { type: "Task" },
          template: DEFAULT_TEMPLATE_KEY,
        },
      ];

      const result = throwIfError(
        await findEntityLocation(fs, paths, schema, mockTask1Node, navigation),
      );
      expect(result).toEqual({
        filePath: `${paths.docs}/tasks/${mockTask1Node.title}.md`,
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
          template: DEFAULT_TEMPLATE_KEY,
        },
      ];

      const result = throwIfError(
        await findEntityLocation(fs, paths, schema, mockTask1Node, navigation),
      );
      expect(result).toEqual({
        filePath: `${paths.docs}/tasks/${mockTask1Node.title}.md`,
        line: 0,
      });
    });
  });

  describe("getNavigationFilePatterns", () => {
    it("converts path templates to glob patterns", () => {
      const items: NavigationItem[] = [
        { path: "tasks/{title}", template: DEFAULT_TEMPLATE_KEY },
        {
          path: "projects/{parent.title}/{uid}",
          template: DEFAULT_TEMPLATE_KEY,
        },
        { path: "static/file", template: DEFAULT_TEMPLATE_KEY },
        { path: "dirs/{name}/" },
      ];
      const patterns = getNavigationFilePatterns(items);
      expect(patterns).toEqual([
        "tasks/*.md",
        "projects/*/*.md",
        "static/file.md",
        "dirs/*/",
      ]);
    });
  });
});

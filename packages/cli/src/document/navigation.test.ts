import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import {
  type Fieldset,
  type FieldsetNested,
  type KnowledgeGraph,
  openKnowledgeGraph,
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
import { mockConfig } from "../runtime.mock.ts";
import { parseView } from "./markdown.ts";
import { renderView } from "./view.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  DEFAULT_DYNAMIC_VIEW,
  findNavigationItemByPath,
  type NavigationItem,
  renderNavigation,
} from "./navigation.ts";

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

    it("matches markdown file by path template", () => {
      const item: NavigationItem = {
        path: "tasks/{title}.md",
        view: DEFAULT_DYNAMIC_VIEW,
      };
      check([item], "tasks/my-task.md", item);
    });

    it("matches yaml file by path template", () => {
      const item: NavigationItem = {
        path: "all-tasks.yaml",
        query: { filters: { type: "Task" } },
      };
      check([item], "all-tasks.yaml", item);
    });

    it("returns undefined when no match found", () => {
      const item: NavigationItem = {
        path: "tasks/{title}.md",
        view: DEFAULT_DYNAMIC_VIEW,
      };
      check([item], "projects/my-project.md", undefined);
    });

    it("returns first matching item", () => {
      const first: NavigationItem = {
        path: "tasks/{title}.md",
        view: DEFAULT_DYNAMIC_VIEW,
      };
      check(
        [first, { path: "tasks/{key}.md", view: DEFAULT_DYNAMIC_VIEW }],
        "tasks/my-task.md",
        first,
      );
    });

    it("matches nested child item", () => {
      const childItem: NavigationItem = {
        path: "info.md",
        view: DEFAULT_DYNAMIC_VIEW,
      };
      check(
        [{ path: "tasks/{title}/", children: [childItem] }],
        "tasks/my-task/info.md",
        childItem,
      );
    });

    it("matches deeply nested child", () => {
      const deepChild: NavigationItem = {
        path: "details.yaml",
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
        ".binder/fields.yaml",
        CONFIG_NAVIGATION_ITEMS[0],
      );
    });
  });

  describe("renderNavigation", () => {
    let db: DatabaseCli;
    let kg: KnowledgeGraph;
    let fs: MockFileSystem;
    const paths = mockConfig.paths;
    const docsPath = mockConfig.paths.docs;
    const defaultViewAst = parseView(DEFAULT_DYNAMIC_VIEW);

    beforeEach(async () => {
      db = getTestDatabaseCli();
      kg = openKnowledgeGraph(db);
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));
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
      throwIfError(await renderNavigation(db, kg, fs, paths, navigationItems));

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
          const viewAst = file.view ? parseView(file.view) : defaultViewAst;
          const snapshot = throwIfError(
            renderView(mockNodeSchema, viewAst, file.data),
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
      const staticView = "# Welcome\n\nStatic content\n";
      await check(
        [{ path: "README.md", view: staticView }],
        [{ path: "README.md", content: staticView }],
      );
    });

    it("renders flat navigation item", async () => {
      await check(
        [
          {
            path: "tasks/{title}.md",
            where: { type: "Task" },
            view: DEFAULT_DYNAMIC_VIEW,
          },
        ],
        [
          {
            path: `tasks/${mockTask1Node.title}.md`,
            data: mockTask1Node,
          },
          {
            path: `tasks/${mockTask2Node.title}.md`,
            data: mockTask2Node,
          },
        ],
      );
    });

    it("renders nested item for directory", async () => {
      const infoView = "# Info\n\n{description}";
      await check(
        [
          {
            path: "tasks/{title}/",
            where: { type: "Task" },
            children: [
              {
                path: "info.md",
                view: infoView,
              },
            ],
          },
        ],
        [
          {
            path: `tasks/${mockTask1Node.title}/info.md`,
            view: infoView,
            data: mockTask1Node,
          },
          {
            path: `tasks/${mockTask2Node.title}/info.md`,
            view: infoView,
            data: mockTask2Node,
          },
        ],
      );
    });

    it("renders nested item with query", async () => {
      await check(
        [
          {
            path: "projects/{title}.md",
            where: { type: "Project" },
            view: DEFAULT_DYNAMIC_VIEW,
            children: [
              {
                path: "tasks/{title}.md",
                where: { type: "Task" },
                view: DEFAULT_DYNAMIC_VIEW,
              },
            ],
          },
        ],
        [
          {
            path: `projects/${mockProjectNode.title}.md`,
            data: mockProjectNode,
          },
          {
            path: `projects/${mockProjectNode.title}/tasks/${mockTask1Node.title}.md`,
            data: mockTask1Node,
          },
          {
            path: `projects/${mockProjectNode.title}/tasks/${mockTask2Node.title}.md`,
            data: mockTask2Node,
          },
        ],
      );
    });

    it("renders yaml entity", async () => {
      await check(
        [
          {
            path: "projects/{title}.yaml",
            where: { type: "Project" },
          },
        ],
        [
          {
            path: `projects/${mockProjectNode.title}.yaml`,
            yaml: mockProjectNode,
          },
        ],
      );
    });

    it("renders yaml query results", async () => {
      await check(
        [
          {
            path: "all-tasks.yaml",
            query: { filters: { type: "Task" } },
          },
        ],
        [
          {
            path: "all-tasks.yaml",
            yamlList: [
              mockTask1Node,
              { ...mockTask2Node, project: mockProjectKey },
            ],
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
                path: "tasks.yaml",
                query: { filters: { type: "Task", project: "{uid}" } },
              },
            ],
          },
        ],
        [
          {
            path: `projects/${mockProjectNode.title}/tasks.yaml`,
            yamlList: [{ ...mockTask2Node, project: mockProjectKey }],
          },
        ],
      );
    });

    it("renders config files from query", async () => {
      const typesResult = throwIfError(
        await kg.search({ filters: { type: "Type" } }),
      );

      const allFieldConfigs = throwIfError(
        await kg.search({ filters: { type: "Field" } }),
      ).items;

      await check(
        [
          {
            path: "fields.yaml",
            query: { filters: { type: "Field" } },
          },
          {
            path: "types.yaml",
            query: { filters: { type: "Type" } },
          },
        ],
        [
          {
            path: "fields.yaml",
            yamlList: allFieldConfigs,
          },
          {
            path: "types.yaml",
            yamlList: typesResult.items,
          },
        ],
      );
    });

    it("renders yaml with includes option", async () => {
      const tasksWithProject = throwIfError(
        await kg.search({
          filters: { type: "Task", project: mockProjectNode.uid },
          includes: { project: true },
        }),
      );

      await check(
        [
          {
            path: "tasks-with-project.yaml",
            query: {
              filters: { type: "Task", project: mockProjectNode.uid },
              includes: { project: true },
            },
          },
        ],
        [
          {
            path: "tasks-with-project.yaml",
            yamlList: tasksWithProject.items,
          },
        ],
      );
    });
  });
});

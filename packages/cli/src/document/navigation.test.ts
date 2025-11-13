import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import {
  type Fieldset,
  type KnowledgeGraph,
  openKnowledgeGraph,
} from "@binder/db";
import {
  getTestDatabase,
  mockNodeSchema,
  mockProjectNode,
  mockTask1Node,
  mockTask2Node,
  mockTransactionInit,
} from "@binder/db/mocks";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "../lib/filesystem.mock.ts";
import {
  DEFAULT_DYNAMIC_VIEW,
  extractFieldsFromPath,
  type NavigationItem,
  renderNavigation,
  resolvePath,
} from "./navigation.ts";
import { parseView } from "./markdown.ts";
import { renderView } from "./view.ts";

describe("navigation", () => {
  describe("extractFieldsFromPath", () => {
    const check = (path: string, pathTemplate: string, expected: Fieldset) => {
      const result = throwIfError(extractFieldsFromPath(path, pathTemplate));
      expect(result).toEqual(expected);
    };

    it("extracts single field from path", () => {
      check("tasks/my-task.md", "tasks/{title}.md", { title: "my-task" });
    });

    it("extracts multiple fields from path", () => {
      check(
        "projects/binder/tasks/feature-123.md",
        "projects/{project}/tasks/{key}.md",
        {
          project: "binder",
          key: "feature-123",
        },
      );
    });

    it("extracts fields from path with directories", () => {
      check("docs/2024/january/report.md", "docs/{year}/{month}/{title}.md", {
        year: "2024",
        month: "january",
        title: "report",
      });
    });

    it("returns error when path does not match template", () => {
      const result = extractFieldsFromPath(
        "tasks/my-task.md",
        "projects/{project}/tasks/{key}.md",
      );
      expect(result).toBeErr();
    });
  });

  it("round-trips with resolvePath", () => {
    const item: Fieldset = { project: "binder-cli", title: "My Task" };
    const template = "projects/{project}/{title}.md";
    const path = throwIfError(resolvePath(template, item));
    expect(path).toBe("projects/binder-cli/My Task.md");
    const result = throwIfError(extractFieldsFromPath(path, template));
    expect(result).toEqual({ project: "binder-cli", title: "My Task" });
  });

  describe("renderNavigation", () => {
    let kg: KnowledgeGraph;
    let fs: MockFileSystem;
    const docsPath = "/docs";
    const defaultViewAst = parseView(DEFAULT_DYNAMIC_VIEW);

    beforeEach(async () => {
      const db = getTestDatabase();
      kg = openKnowledgeGraph(db);
      fs = createInMemoryFileSystem();
      throwIfError(await kg.apply(mockTransactionInit));
    });

    const check = async (
      navigationItems: NavigationItem[],
      files: { path: string; view?: string; data: Fieldset }[],
    ) => {
      const errors = throwIfError(
        await renderNavigation(kg, fs, docsPath, navigationItems),
      );
      expect(errors).toEqual([]);

      for (const { path, view, data } of files) {
        const content = throwIfError(await fs.readFile(`${docsPath}/${path}`));

        const viewAst = view ? parseView(view) : defaultViewAst;
        const snapshot = throwIfError(
          renderView(mockNodeSchema, viewAst, data),
        );
        expect(content).toEqual(snapshot);
      }

      const mdFiles = Array.from(fs.files.keys()).filter((f) =>
        f.endsWith(".md"),
      );
      expect(mdFiles).toEqual(files.map((f) => `${docsPath}/${f.path}`));
    };

    it("renders flat navigation item", async () => {
      await check(
        [
          {
            path: "tasks/{title}.md",
            query: "type=Task",
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
            query: "type=Task",
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
            query: "type=Project",
            children: [
              {
                path: "tasks/{title}.md",
                query: "type=Task",
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
  });
});

import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import { mockNodeSchema, mockTask1Node, mockTask2Node } from "@binder/db/mocks";
import { type NavigationItem, type Templates } from "./navigation.ts";
import { mockTemplates } from "./template.mock.ts";
import { extract, type ExtractedFileData } from "./extraction.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";

describe("extract", () => {
  const emptyTemplates: Templates = [];

  const check = (
    navItem: NavigationItem,
    content: string,
    path: string,
    expected: ExtractedFileData,
    templateList: Templates = emptyTemplates,
  ) => {
    const result = throwIfError(
      extract(mockNodeSchema, navItem, content, path, templateList),
    );
    expect(result).toEqual(expected);
  };

  const markdownNavItem: NavigationItem = {
    path: "tasks/{key}",
    template: "task-template",
  };

  const yamlSingleNavItem: NavigationItem = {
    path: "tasks/{key}",
    includes: { title: true, status: true },
  };

  const yamlListNavItem: NavigationItem = {
    path: "all-tasks",
    query: { filters: { type: "Task" } },
  };

  describe("markdown", () => {
    it("extracts document entity from markdown", () => {
      const markdown = `# ${mockTask1Node.title}

**Status:** ${mockTask1Node.status}

## Description

${mockTask1Node.description}
`;
      check(
        markdownNavItem,
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            title: mockTask1Node.title,
            status: mockTask1Node.status,
            description: mockTask1Node.description,
          },
          projections: [],
        },
        mockTemplates,
      );
    });
  });

  describe("yaml single", () => {
    it("extracts entity from yaml", () => {
      check(
        yamlSingleNavItem,
        renderYamlEntity({
          title: mockTask1Node.title,
          status: mockTask1Node.status,
        }),
        "task.yaml",
        {
          kind: "single",
          entity: { title: mockTask1Node.title, status: mockTask1Node.status },
        },
      );
    });
  });

  describe("yaml list", () => {
    it("extracts entities from yaml list", () => {
      check(
        yamlListNavItem,
        renderYamlList([
          { uid: mockTask1Node.uid, title: mockTask1Node.title },
          { uid: mockTask2Node.uid, title: mockTask2Node.title },
        ]),
        "all-tasks.yaml",
        {
          kind: "list",
          entities: [
            { uid: mockTask1Node.uid, title: mockTask1Node.title },
            { uid: mockTask2Node.uid, title: mockTask2Node.title },
          ],
          query: { filters: { type: "Task" } },
        },
      );
    });

    it("removes duplicate uids from yaml list", () => {
      check(
        yamlListNavItem,
        renderYamlList([
          { uid: mockTask1Node.uid, title: "First" },
          { uid: mockTask1Node.uid, title: "Duplicate" },
          { uid: mockTask2Node.uid, title: "Second" },
        ]),
        "all-tasks.yaml",
        {
          kind: "list",
          entities: [
            { uid: mockTask1Node.uid, title: "First" },
            { title: "Duplicate" },
            { uid: mockTask2Node.uid, title: "Second" },
          ],
          query: { filters: { type: "Task" } },
        },
      );
    });

    it("keeps non-string uids unchanged", () => {
      check(
        yamlListNavItem,
        renderYamlList([
          { uid: 123, title: "Number uid" },
          { uid: 123, title: "Same number uid" },
        ]),
        "all-tasks.yaml",
        {
          kind: "list",
          entities: [
            { uid: 123, title: "Number uid" },
            { uid: 123, title: "Same number uid" },
          ],
          query: { filters: { type: "Task" } },
        },
      );
    });
  });

  describe("error cases", () => {
    it("returns error when yaml navigation item has no query or includes", () => {
      const navItemWithoutQuery: NavigationItem = { path: "all-tasks" };
      const yaml = renderYamlList([{ title: "Task" }]);

      const result = extract(
        mockNodeSchema,
        navItemWithoutQuery,
        yaml,
        "all-tasks.yaml",
        emptyTemplates,
      );

      expect(result).toBeErrWithKey("invalid_yaml_config");
    });

    it("returns error for unsupported file extension", () => {
      const result = extract(
        mockNodeSchema,
        markdownNavItem,
        "content",
        "file.txt",
        mockTemplates,
      );

      expect(result).toBeErrWithKey("unsupported_file_type");
    });
  });
});

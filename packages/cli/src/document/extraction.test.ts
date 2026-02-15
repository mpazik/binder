import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import { mockNodeSchema, mockTask1Node, mockTask2Node } from "@binder/db/mocks";
import { type NavigationItem } from "./navigation.ts";
import {
  mockTemplates,
  mockPreambleTemplate,
  mockPreambleStatusInBodyTemplate,
} from "./template.mock.ts";
import { extract, type ExtractedFileData } from "./extraction.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import type { Templates } from "./template-entity.ts";

describe("extract", () => {
  const emptyTemplates: Templates = [];

  const check = (
    navItem: NavigationItem,
    content: string,
    path: string,
    expected: ExtractedFileData,
    templateList: Templates = emptyTemplates,
    base: FieldsetNested = {},
  ) => {
    const result = throwIfError(
      extract(mockNodeSchema, navItem, content, path, templateList, base),
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
          includes: { title: true, status: true, description: true },
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

  describe("markdown with frontmatter", () => {
    const preambleTemplates: Templates = [
      mockPreambleTemplate,
      mockPreambleStatusInBodyTemplate,
      ...mockTemplates,
    ];

    const preambleNavItem: NavigationItem = {
      path: "tasks/{key}",
      template: "task-preamble",
    };

    it("extracts frontmatter fields, merges with body, and includes preamble keys", () => {
      const markdown = `---
status: ${mockTask1Node.status}
---

# ${mockTask1Node.title}

## Description

${mockTask1Node.description}
`;
      check(
        preambleNavItem,
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
          // status is in includes via preamble, not the template body
          includes: { title: true, status: true, description: true },
        },
        preambleTemplates,
      );
    });

    it("detects conflict when frontmatter and body have different values with no base", () => {
      // No base entity (empty base). Body has status: "pending", frontmatter has status: "active".
      // Both differ from base (undefined) and differ from each other → conflict.
      const markdown = `---
status: active
---

# My Task

**Status:** pending
`;
      const result = extract(
        mockNodeSchema,
        { path: "tasks/{key}", template: "task-status-body" },
        markdown,
        "task.md",
        preambleTemplates,
        {},
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("should preserve body edit when frontmatter matches base", () => {
      // Base entity in DB has status: "active"
      // User edited body to status: "done", frontmatter still says "active"
      // Expected: sparse result with only changed field status: "done"
      // (title: "My Task" matches base → omitted; fm status: "active" matches base → omitted)
      const base = { title: "My Task", status: "active" };
      const markdown = `---
status: active
---

# My Task

**Status:** done
`;
      check(
        { path: "tasks/{key}", template: "task-status-body" },
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            status: "done",
          },
          projections: [],
          includes: { title: true, status: true },
        },
        preambleTemplates,
        base,
      );
    });

    it("should detect conflict when body and frontmatter both changed to different values", () => {
      // Base entity in DB has status: "active"
      // User edited frontmatter to "pending" AND body to "done"
      // Both differ from base, and differ from each other → conflict
      const base = { title: "My Task", status: "active" };
      const markdown = `---
status: pending
---

# My Task

**Status:** done
`;
      const result = extract(
        mockNodeSchema,
        { path: "tasks/{key}", template: "task-status-body" },
        markdown,
        "task.md",
        preambleTemplates,
        base,
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("handles missing frontmatter when template has preamble", () => {
      const markdown = `# ${mockTask1Node.title}

## Description

${mockTask1Node.description}
`;
      check(
        preambleNavItem,
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            title: mockTask1Node.title,
            description: mockTask1Node.description,
          },
          projections: [],
          includes: { title: true, status: true, description: true },
        },
        preambleTemplates,
      );
    });

    it("propagates error for malformed frontmatter YAML", () => {
      const markdown = `---
: invalid: yaml: [
---

# Title

## Description

Content
`;
      const result = extract(
        mockNodeSchema,
        preambleNavItem,
        markdown,
        "task.md",
        preambleTemplates,
        {},
      );
      expect(result).toBeErr();
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
        {},
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
        {},
      );

      expect(result).toBeErrWithKey("unsupported_file_type");
    });
  });
});

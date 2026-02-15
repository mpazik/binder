import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import {
  mockRecordSchema,
  mockTask1Record,
  mockTask2Record,
} from "@binder/db/mocks";
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
      extract(mockRecordSchema, navItem, content, path, templateList, base),
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
      const markdown = `# ${mockTask1Record.title}

**Status:** ${mockTask1Record.status}

## Description

${mockTask1Record.description}
`;
      check(
        markdownNavItem,
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            title: mockTask1Record.title,
            status: mockTask1Record.status,
            description: mockTask1Record.description,
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
          title: mockTask1Record.title,
          status: mockTask1Record.status,
        }),
        "task.yaml",
        {
          kind: "single",
          entity: {
            title: mockTask1Record.title,
            status: mockTask1Record.status,
          },
        },
      );
    });
  });

  describe("yaml list", () => {
    it("extracts entities from yaml list", () => {
      check(
        yamlListNavItem,
        renderYamlList([
          { uid: mockTask1Record.uid, title: mockTask1Record.title },
          { uid: mockTask2Record.uid, title: mockTask2Record.title },
        ]),
        "all-tasks.yaml",
        {
          kind: "list",
          entities: [
            { uid: mockTask1Record.uid, title: mockTask1Record.title },
            { uid: mockTask2Record.uid, title: mockTask2Record.title },
          ],
          query: { filters: { type: "Task" } },
        },
      );
    });

    it("removes duplicate uids from yaml list", () => {
      check(
        yamlListNavItem,
        renderYamlList([
          { uid: mockTask1Record.uid, title: "First" },
          { uid: mockTask1Record.uid, title: "Duplicate" },
          { uid: mockTask2Record.uid, title: "Second" },
        ]),
        "all-tasks.yaml",
        {
          kind: "list",
          entities: [
            { uid: mockTask1Record.uid, title: "First" },
            { title: "Duplicate" },
            { uid: mockTask2Record.uid, title: "Second" },
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
status: ${mockTask1Record.status}
---

# ${mockTask1Record.title}

## Description

${mockTask1Record.description}
`;
      check(
        preambleNavItem,
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            title: mockTask1Record.title,
            status: mockTask1Record.status,
            description: mockTask1Record.description,
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
        mockRecordSchema,
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
        mockRecordSchema,
        { path: "tasks/{key}", template: "task-status-body" },
        markdown,
        "task.md",
        preambleTemplates,
        base,
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("handles missing frontmatter when template has preamble", () => {
      const markdown = `# ${mockTask1Record.title}

## Description

${mockTask1Record.description}
`;
      check(
        preambleNavItem,
        markdown,
        "task.md",
        {
          kind: "document",
          entity: {
            title: mockTask1Record.title,
            description: mockTask1Record.description,
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
        mockRecordSchema,
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
        mockRecordSchema,
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
        mockRecordSchema,
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

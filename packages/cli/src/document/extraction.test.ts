import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/repo";
import {
  mockRecordSchema,
  mockTask1Record,
  mockTask2Record,
} from "@binder/repo/mocks";
import { type NavigationItem } from "./navigation.ts";
import {
  mockViews,
  mockPreambleView,
  mockPreambleStatusInBodyView,
} from "./view.mock.ts";
import { extract, type ExtractedFileData } from "./extraction.ts";
import { renderYamlEntity, renderYamlList } from "./yaml.ts";
import { createViewEntity, type Views } from "./view-entity.ts";

describe("extract", () => {
  const emptyViews: Views = [];

  const check = (
    navItem: NavigationItem,
    content: string,
    path: string,
    expected: ExtractedFileData,
    viewList: Views = emptyViews,
    base: FieldsetNested = {},
  ) => {
    const result = throwIfError(
      extract(mockRecordSchema, navItem, content, path, viewList, base),
    );
    expect(result).toEqual(expected);
  };

  const markdownNavItem: NavigationItem = {
    path: "tasks/{key}",
    view: "task-view",
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
        mockViews,
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
    const preambleViews: Views = [
      mockPreambleView,
      mockPreambleStatusInBodyView,
      ...mockViews,
    ];

    const preambleNavItem: NavigationItem = {
      path: "tasks/{key}",
      view: "task-preamble",
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
          // status is in includes via preamble, not the view body
          includes: { title: true, status: true, description: true },
        },
        preambleViews,
      );
    });

    it("detects conflict when frontmatter and body have different values with no base", () => {
      const markdown = `---
status: active
---

# My Task

**Status:** pending
`;
      const result = extract(
        mockRecordSchema,
        { path: "tasks/{key}", view: "task-status-body" },
        markdown,
        "task.md",
        preambleViews,
        {},
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("preserves body edit when frontmatter matches base", () => {
      const base = { title: "My Task", status: "active" };
      const markdown = `---
status: active
---

# My Task

**Status:** done
`;
      check(
        { path: "tasks/{key}", view: "task-status-body" },
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
        preambleViews,
        base,
      );
    });

    it("detects conflict when body and frontmatter both changed to different values", () => {
      const base = { title: "My Task", status: "active" };
      const markdown = `---
status: pending
---

# My Task

**Status:** done
`;
      const result = extract(
        mockRecordSchema,
        { path: "tasks/{key}", view: "task-status-body" },
        markdown,
        "task.md",
        preambleViews,
        base,
      );
      expect(result).toBeErrWithKey("field-conflict");
    });

    it("handles missing frontmatter when view has preamble", () => {
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
        preambleViews,
      );
    });

    it("does not conflict when frontmatter has relation ref and body has relation projection", () => {
      // Reproduces the journal-day bug: view has `parent` in preamble
      // and uses {parent.title} in body. Frontmatter holds the ref string
      // ("some-parent-key") while body extraction produces a nested object
      // ({ title: "Parent Title" }). These are complementary, not conflicting.
      const viewEntry = createViewEntity(
        "task-with-parent-body",
        `# {title}

## Parent

{parent.title}
`,
        { preamble: ["parent"] },
      );
      const allViews: Views = [viewEntry, ...mockViews];

      const markdown = `---
parent: some-parent-key
---

# My Task

## Parent

Parent Title
`;
      const result = extract(
        mockRecordSchema,
        { path: "tasks/{key}", view: "task-with-parent-body" },
        markdown,
        "task.md",
        allViews,
        {},
      );
      expect(result).toBeOk();
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
        preambleViews,
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
        emptyViews,
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
        mockViews,
        {},
      );

      expect(result).toBeErrWithKey("unsupported_file_type");
    });
  });
});

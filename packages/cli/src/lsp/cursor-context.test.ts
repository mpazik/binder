import { describe, expect, it } from "bun:test";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { assertFailed } from "@binder/utils";
import {
  mockRecordSchema,
  mockTask1Uid,
  mockTaskTypeKey,
  mockProjectFieldKey,
  mockStatusFieldKey,
} from "@binder/db/mocks";
import { tagsFieldKey } from "@binder/db";
import { LineCounter } from "yaml";
import { parseYamlDocument } from "../document/yaml-cst.ts";
import { parseMarkdownDocument } from "../document/markdown.ts";
import type { FieldSlotMapping } from "../document/template.ts";
import type { NavigationItem } from "../document/navigation.ts";
import type { EntityMapping, EntityMappings } from "./entity-mapping.ts";
import type {
  FrontmatterContext,
  MarkdownDocumentContext,
  YamlDocumentContext,
} from "./document-context.ts";
import {
  getCursorContext,
  getSchemaFieldPath,
  getSiblingValues,
  type CursorEntityContext,
  type MarkdownCursorContext,
  type YamlCursorContext,
  isPositionInRange,
  unistPositionToLspRange,
  offsetToPosition,
  positionToOffset,
  yamlRangeToLspRange,
} from "./cursor-context.ts";

const CURSOR = "█";

const parseCursor = (
  contentWithCursor: string,
): { content: string; line: number; character: number } => {
  const cursorIndex = contentWithCursor.indexOf(CURSOR);
  if (cursorIndex === -1) {
    assertFailed(`Cursor marker "${CURSOR}" not found in content`);
  }

  const content =
    contentWithCursor.slice(0, cursorIndex) +
    contentWithCursor.slice(cursorIndex + CURSOR.length);

  const beforeCursor = contentWithCursor.slice(0, cursorIndex);
  const lines = beforeCursor.split("\n");
  const line = lines.length - 1;
  const character = lines[line].length;

  return { content, line, character };
};

const mockMatchedMapping: EntityMapping = {
  status: "matched",
  uid: mockTask1Uid,
  type: mockTaskTypeKey,
};

const mockNewMapping: EntityMapping = {
  status: "new",
  type: mockTaskTypeKey,
};

const mockNavigationItem: NavigationItem = {
  path: "test.yaml",
  query: { filters: { type: mockTaskTypeKey } },
};

const createYamlContext = (
  contentWithCursor: string,
  entityMappings: EntityMappings,
): { context: YamlDocumentContext; line: number; character: number } => {
  const { content, line, character } = parseCursor(contentWithCursor);
  return {
    context: {
      documentType: "yaml",
      document: { getText: () => content } as TextDocument,
      uri: "file:///test.yaml",
      namespace: "record",
      schema: mockRecordSchema,
      navigationItem: mockNavigationItem,
      typeDef: mockRecordSchema.types[mockTaskTypeKey],
      entityMappings,
      parsed: parseYamlDocument(content),
    },
    line,
    character,
  };
};

describe("cursor-context", () => {
  describe("getCursorContext entity resolution", () => {
    const mockSingleMappings: EntityMappings = {
      kind: "single",
      mapping: mockMatchedMapping,
    };

    const mockListMappings: EntityMappings = {
      kind: "list",
      mappings: [mockMatchedMapping, mockNewMapping],
    };

    const mockDocumentMappings: EntityMappings = {
      kind: "document",
      mapping: mockMatchedMapping,
    };

    const mockNewMappings: EntityMappings = {
      kind: "single",
      mapping: mockNewMapping,
    };

    const checkEntity = (
      contentWithCursor: string,
      entityMappings: EntityMappings,
      expected: CursorEntityContext,
    ) => {
      const { context, line, character } = createYamlContext(
        contentWithCursor,
        entityMappings,
      );
      const result = getCursorContext(context, { line, character });
      expect(result.entity).toEqual(expected);
    };

    it("single entity returns entity at index 0", () => {
      checkEntity(
        `- title: First█ Task
  status: todo
- title: Second Task
  status: done`,
        mockSingleMappings,
        {
          mapping: mockMatchedMapping,
          entityIndex: 0,
          typeDef: mockRecordSchema.types[mockTaskTypeKey],
        },
      );
    });

    it("list returns first entity when cursor is on first item", () => {
      checkEntity(
        `- title: First█ Task
  status: todo
- title: Second Task
  status: done`,
        mockListMappings,
        {
          mapping: mockMatchedMapping,
          entityIndex: 0,
          typeDef: mockRecordSchema.types[mockTaskTypeKey],
        },
      );
    });

    it("list returns second entity when cursor is on second item", () => {
      checkEntity(
        `- title: First Task
  status: todo
- title: Second█ Task
  status: done`,
        mockListMappings,
        {
          mapping: mockNewMapping,
          entityIndex: 1,
          typeDef: undefined,
        },
      );
    });

    it("document returns entity at index 0", () => {
      checkEntity(
        `- title: First█ Task
  status: todo
- title: Second Task
  status: done`,
        mockDocumentMappings,
        {
          mapping: mockMatchedMapping,
          entityIndex: 0,
          typeDef: mockRecordSchema.types[mockTaskTypeKey],
        },
      );
    });

    it("new entity returns undefined typeDef", () => {
      checkEntity(
        `- title: First█ Task
  status: todo
- title: Second Task
  status: done`,
        mockNewMappings,
        {
          mapping: mockNewMapping,
          entityIndex: 0,
          typeDef: undefined,
        },
      );
    });
  });

  describe("getCursorContext type detection", () => {
    const singleMapping: EntityMappings = {
      kind: "single",
      mapping: mockMatchedMapping,
    };

    const check = (
      contentWithCursor: string,
      expected: Partial<YamlCursorContext>,
    ) => {
      const { context, line, character } = createYamlContext(
        contentWithCursor,
        singleMapping,
      );
      const result = getCursorContext(context, { line, character });
      expect(result).toMatchObject(expected);
    };

    it("returns field-key when cursor is on field name", () => {
      check(
        `tit█le: My Task
status: todo`,
        {
          type: "field-key",
          fieldPath: ["title"],
        },
      );
    });

    it("returns field-value when cursor is on scalar value", () => {
      check(
        `title: My█ Task
status: todo`,
        {
          type: "field-value",
          fieldPath: ["title"],
          currentValue: "My Task",
        },
      );
    });

    it("returns field-value when cursor is after colon with empty value", () => {
      check(
        `title: █
status: todo`,
        {
          type: "field-value",
          fieldPath: ["title"],
        },
      );
    });

    it("returns field-value for relation field", () => {
      check(`project: █`, {
        type: "field-value",
        fieldPath: [mockProjectFieldKey],
        fieldDef: expect.objectContaining({
          key: mockProjectFieldKey,
          dataType: "relation",
        }),
      });
    });

    it("returns field-value for option field", () => {
      check(`status: pend█ing`, {
        type: "field-value",
        fieldPath: [mockStatusFieldKey],
        currentValue: "pending",
        fieldDef: expect.objectContaining({
          key: mockStatusFieldKey,
          dataType: "option",
        }),
      });
    });

    it("returns field-value when cursor is on sequence item", () => {
      check(
        `title: My Task
tags:
  - urg█ent
  - important`,
        {
          type: "field-value",
          fieldPath: [tagsFieldKey, "0"],
          itemIndex: 0,
          currentValue: "urgent",
        },
      );
    });

    it("returns field-value for second sequence item", () => {
      check(
        `title: My Task
tags:
  - urgent
  - import█ant`,
        {
          type: "field-value",
          fieldPath: [tagsFieldKey, "1"],
          itemIndex: 1,
          currentValue: "important",
        },
      );
    });

    it("returns field-value for empty sequence item", () => {
      check(
        `title: My Task
tags:
  - █`,
        {
          type: "field-value",
          fieldPath: [tagsFieldKey, "0"],
          itemIndex: 0,
        },
      );
    });

    it("returns none when cursor is in empty document", () => {
      check(`█`, { type: "none" });
    });

    it("returns none for unknown field", () => {
      check(`unknownField: █value`, { type: "none" });
    });
  });

  describe("getSchemaFieldPath", () => {
    it("removes numeric indices from path", () => {
      expect(getSchemaFieldPath(["tags", "0"])).toEqual(["tags"]);
      expect(getSchemaFieldPath(["tasks", "1", "title"])).toEqual([
        "tasks",
        "title",
      ]);
    });

    it("preserves path without indices", () => {
      expect(getSchemaFieldPath(["title"])).toEqual(["title"]);
      expect(getSchemaFieldPath(["meta", "author"])).toEqual([
        "meta",
        "author",
      ]);
    });
  });

  describe("getSiblingValues", () => {
    const singleMapping: EntityMappings = {
      kind: "single",
      mapping: mockMatchedMapping,
    };

    it("returns all values in sequence", () => {
      const { context } = createYamlContext(
        `title: My Task
tags:
  - urgent
  - important
  - █low`,
        singleMapping,
      );
      const result = getSiblingValues(context, ["tags", "2"]);
      expect(result).toEqual(["urgent", "important", "low"]);
    });

    it("returns empty array for non-sequence field", () => {
      const { context } = createYamlContext(`title: My█ Task`, singleMapping);
      const result = getSiblingValues(context, ["title"]);
      expect(result).toEqual([]);
    });

    it("returns empty array for non-existent path", () => {
      const { context } = createYamlContext(`title: My█ Task`, singleMapping);
      const result = getSiblingValues(context, ["nonexistent"]);
      expect(result).toEqual([]);
    });
  });

  describe("getCursorContext for markdown", () => {
    const mockNavigationItemWithTemplate: NavigationItem = {
      path: "test.md",
      query: { filters: { type: mockTaskTypeKey } },
      template: "task-template",
    };

    const mockNavigationItemNoTemplate: NavigationItem = {
      path: "test.md",
      query: { filters: { type: mockTaskTypeKey } },
    };

    const singleMapping: EntityMappings = {
      kind: "single",
      mapping: mockMatchedMapping,
    };

    const buildFrontmatter = (
      parsed: ReturnType<typeof parseMarkdownDocument>,
      preambleKeys: string[],
    ): FrontmatterContext | undefined => {
      const yamlNode = parsed.root.children.find((c) => c.type === "yaml");
      if (!yamlNode || !("value" in yamlNode) || !yamlNode.position)
        return undefined;
      return {
        parsed: parseYamlDocument(yamlNode.value as string),
        lineOffset: yamlNode.position.start.line,
        preambleKeys,
      };
    };

    const createMarkdownContext = (
      contentWithCursor: string,
      fieldMappings: FieldSlotMapping[],
      opts?: {
        navigationItem?: NavigationItem;
        preambleKeys?: string[];
      },
    ): {
      context: MarkdownDocumentContext;
      line: number;
      character: number;
    } => {
      const { content, line, character } = parseCursor(contentWithCursor);
      const parsed = parseMarkdownDocument(content);
      return {
        context: {
          documentType: "markdown",
          document: { getText: () => content } as TextDocument,
          uri: "file:///test.md",
          namespace: "record",
          schema: mockRecordSchema,
          navigationItem:
            opts?.navigationItem ?? mockNavigationItemWithTemplate,
          typeDef: mockRecordSchema.types[mockTaskTypeKey],
          entityMappings: singleMapping,
          parsed,
          fieldMappings,
          frontmatter: opts?.preambleKeys
            ? buildFrontmatter(parsed, opts.preambleKeys)
            : undefined,
        },
        line,
        character,
      };
    };

    const check = (
      contentWithCursor: string,
      fieldMappings: FieldSlotMapping[],
      expected: Partial<MarkdownCursorContext>,
      opts?: {
        navigationItem?: NavigationItem;
        preambleKeys?: string[];
      },
    ) => {
      const { context, line, character } = createMarkdownContext(
        contentWithCursor,
        fieldMappings,
        opts,
      );
      const result = getCursorContext(context, { line, character });
      expect(result).toMatchObject(expected);
    };

    it("returns field-value when cursor is inside field mapping", () => {
      const fieldMappings: FieldSlotMapping[] = [
        {
          path: ["title"],
          position: {
            start: { line: 1, column: 3 },
            end: { line: 1, column: 10 },
          },
        },
      ];

      check(`# My█ Task`, fieldMappings, {
        documentType: "markdown",
        type: "field-value",
        fieldPath: ["title"],
        fieldDef: expect.objectContaining({ dataType: "plaintext" }),
      });
    });

    it("returns field-value with correct range", () => {
      const fieldMappings: FieldSlotMapping[] = [
        {
          path: ["status"],
          position: {
            start: { line: 2, column: 1 },
            end: { line: 2, column: 8 },
          },
        },
      ];

      check(
        `# My Task
pend█ing`,
        fieldMappings,
        {
          documentType: "markdown",
          type: "field-value",
          fieldPath: ["status"],
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 7 },
          },
        },
      );
    });

    it("returns template when cursor is outside field mappings but template exists", () => {
      check(`Some random █text`, [], {
        documentType: "markdown",
        type: "template",
        templateKey: "task-template",
      });
    });

    it("returns none when cursor is outside field mappings and no template", () => {
      check(
        `Some random █text`,
        [],
        {
          documentType: "markdown",
          type: "none",
        },
        { navigationItem: mockNavigationItemNoTemplate },
      );
    });

    it("returns field-value for project relation field", () => {
      const fieldMappings: FieldSlotMapping[] = [
        {
          path: ["project"],
          position: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 15 },
          },
        },
      ];

      check(`my-pro█ject-key`, fieldMappings, {
        documentType: "markdown",
        type: "field-value",
        fieldPath: ["project"],
        fieldDef: expect.objectContaining({ dataType: "relation" }),
      });
    });

    it("returns frontmatter-field-value for option field in frontmatter", () => {
      check(
        `---\nstatus: pend█ing\n---\n\n# My Task`,
        [],
        {
          documentType: "markdown",
          type: "frontmatter-field-value",
          fieldPath: [mockStatusFieldKey],
          currentValue: "pending",
          fieldDef: expect.objectContaining({
            key: mockStatusFieldKey,
            dataType: "option",
          }),
        },
        { preambleKeys: [mockStatusFieldKey] },
      );
    });

    it("returns frontmatter-field-value for empty option field in frontmatter", () => {
      check(
        `---\nstatus: █\n---\n\n# My Task`,
        [],
        {
          documentType: "markdown",
          type: "frontmatter-field-value",
          fieldPath: [mockStatusFieldKey],
          fieldDef: expect.objectContaining({
            key: mockStatusFieldKey,
            dataType: "option",
          }),
        },
        { preambleKeys: [mockStatusFieldKey] },
      );
    });

    it("returns frontmatter-field-key for field key in frontmatter", () => {
      check(
        `---\nsta█tus: pending\n---\n\n# My Task`,
        [],
        {
          documentType: "markdown",
          type: "frontmatter-field-key",
          fieldPath: [mockStatusFieldKey],
          fieldDef: expect.objectContaining({
            key: mockStatusFieldKey,
            dataType: "option",
          }),
        },
        { preambleKeys: [mockStatusFieldKey] },
      );
    });

    it("falls through to body context for frontmatter field key not in preambleKeys", () => {
      check(
        `---\nproj█ect: my-project\n---\n\n# My Task`,
        [],
        {
          documentType: "markdown",
          type: "template",
          templateKey: "task-template",
        },
        { preambleKeys: [mockStatusFieldKey] },
      );
    });

    it("includes slot in field-value context", () => {
      const fieldMappings: FieldSlotMapping[] = [
        {
          path: ["title"],
          position: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 10 },
          },
        },
      ];

      check(`My█ Task`, fieldMappings, {
        documentType: "markdown",
        type: "field-value",
        slot: fieldMappings[0],
      });
    });
  });

  describe("offsetToPosition", () => {
    const createLineCounter = (text: string): LineCounter => {
      const lc = new LineCounter();
      let offset = 0;
      for (const line of text.split("\n")) {
        lc.addNewLine(offset);
        offset += line.length + 1;
      }
      return lc;
    };

    it("converts offset at start of document", () => {
      const lc = createLineCounter("hello\nworld");
      expect(offsetToPosition(0, lc)).toEqual({ line: 0, character: 0 });
    });

    it("converts offset in first line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(offsetToPosition(3, lc)).toEqual({ line: 0, character: 3 });
    });

    it("converts offset at start of second line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(offsetToPosition(6, lc)).toEqual({ line: 1, character: 0 });
    });

    it("converts offset in second line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(offsetToPosition(8, lc)).toEqual({ line: 1, character: 2 });
    });
  });

  describe("positionToOffset", () => {
    const createLineCounter = (text: string): LineCounter => {
      const lc = new LineCounter();
      let offset = 0;
      for (const line of text.split("\n")) {
        lc.addNewLine(offset);
        offset += line.length + 1;
      }
      return lc;
    };

    it("converts position at start of document", () => {
      const lc = createLineCounter("hello\nworld");
      expect(positionToOffset({ line: 0, character: 0 }, lc)).toBe(0);
    });

    it("converts position in first line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(positionToOffset({ line: 0, character: 3 }, lc)).toBe(3);
    });

    it("converts position at start of second line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(positionToOffset({ line: 1, character: 0 }, lc)).toBe(6);
    });

    it("converts position in second line", () => {
      const lc = createLineCounter("hello\nworld");
      expect(positionToOffset({ line: 1, character: 2 }, lc)).toBe(8);
    });
  });

  describe("yamlRangeToLspRange", () => {
    const createLineCounter = (text: string): LineCounter => {
      const lc = new LineCounter();
      let offset = 0;
      for (const line of text.split("\n")) {
        lc.addNewLine(offset);
        offset += line.length + 1;
      }
      return lc;
    };

    it("converts yaml range to lsp range", () => {
      const lc = createLineCounter("hello\nworld");
      const result = yamlRangeToLspRange([0, 5, 5], lc);
      expect(result).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      });
    });

    it("converts range spanning multiple lines", () => {
      const lc = createLineCounter("hello\nworld");
      const result = yamlRangeToLspRange([0, 6, 11], lc);
      expect(result).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 1, character: 5 },
      });
    });
  });

  describe("isPositionInRange", () => {
    const range = {
      start: { line: 1, character: 5 },
      end: { line: 3, character: 10 },
    };

    it("returns true for position at start of range", () => {
      expect(isPositionInRange({ line: 1, character: 5 }, range)).toBe(true);
    });

    it("returns true for position at end of range", () => {
      expect(isPositionInRange({ line: 3, character: 10 }, range)).toBe(true);
    });

    it("returns true for position in middle of range", () => {
      expect(isPositionInRange({ line: 2, character: 0 }, range)).toBe(true);
    });

    it("returns false for position before range", () => {
      expect(isPositionInRange({ line: 1, character: 4 }, range)).toBe(false);
    });

    it("returns false for position after range", () => {
      expect(isPositionInRange({ line: 3, character: 11 }, range)).toBe(false);
    });

    it("returns false for position on earlier line", () => {
      expect(isPositionInRange({ line: 0, character: 10 }, range)).toBe(false);
    });

    it("returns false for position on later line", () => {
      expect(isPositionInRange({ line: 4, character: 0 }, range)).toBe(false);
    });
  });

  describe("unistPositionToLspRange", () => {
    it("converts unist position to lsp range (1-indexed to 0-indexed)", () => {
      const unistPos = {
        start: { line: 1, column: 1 },
        end: { line: 2, column: 10 },
      };
      expect(unistPositionToLspRange(unistPos)).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 1, character: 9 },
      });
    });
  });
});

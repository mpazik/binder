import { describe, expect, it } from "bun:test";
import type { FieldDef, FieldValue } from "@binder/db";
import {
  mockDueDateField,
  mockRecordSchema,
  mockNotesField,
  mockOwnersField,
  mockProjectField,
  mockStatusField,
  mockFavoriteField,
  mockTasksField,
} from "@binder/db/mocks";
import type { Position as UnistPosition } from "unist";
import type { FieldSlotMapping } from "../../document/template.ts";
import {
  collectRelationRefs,
  extractRelationRefs,
  mapFieldPathToRange,
  type RelationRef,
  unistPositionToRange,
  validateFieldValue,
  validateMarkdownFields,
  type FieldValidationError,
} from "./diagnostics.ts";

describe("diagnostics", () => {
  describe("validateFieldValue", () => {
    const check = (
      fieldDef: FieldDef,
      value: FieldValue,
      expected: FieldValidationError | undefined,
    ) => {
      const result = validateFieldValue({
        fieldPath: [fieldDef.key],
        fieldDef,
        value,
        namespace: "record",
      });
      expect(result).toEqual(expected);
    };

    it("returns undefined for valid option value", () => {
      check(mockStatusField, "pending", undefined);
    });

    it("returns error for invalid option value", () => {
      check(mockStatusField, "invalid-status", {
        fieldPath: ["status"],
        code: "invalid-value",
        message:
          "Invalid value for field 'status': Invalid option value: invalid-status. Expected one of: pending, active, complete, cancelled, archived",
      });
    });

    it("returns undefined for valid boolean value", () => {
      check(mockFavoriteField, true, undefined);
    });

    it("returns error for non-boolean value in boolean field", () => {
      check(mockFavoriteField, "yes", {
        fieldPath: ["favorite"],
        code: "invalid-value",
        message:
          "Invalid value for field 'favorite': Expected boolean, got: string",
      });
    });

    it("returns undefined for valid date value", () => {
      check(mockDueDateField, "2024-01-15", undefined);
    });

    it("returns error for invalid date format", () => {
      check(mockDueDateField, "01-15-2024", {
        fieldPath: ["dueDate"],
        code: "invalid-value",
        message:
          "Invalid value for field 'dueDate': Expected ISO date format (YYYY-MM-DD), got: 01-15-2024",
      });
    });

    it("returns undefined for valid relation value", () => {
      check(mockProjectField, "project-123", undefined);
    });

    it("returns undefined for valid multi-value relation array", () => {
      check(mockOwnersField, ["user-1", "user-2"], undefined);
    });

    it("accepts single value for allowMultiple field (normalized to array)", () => {
      check(mockOwnersField, "user-1", undefined);
    });
  });

  describe("extractRelationRefs", () => {
    const check = (
      fieldDef: FieldDef,
      value: FieldValue,
      expected: RelationRef[],
    ) => {
      const result = extractRelationRefs({
        fieldPath: [fieldDef.key],
        fieldDef,
        value,
      });
      expect(result).toEqual(expected);
    };

    it("returns empty array for non-relation field", () => {
      check(mockStatusField, "pending", []);
    });

    it("returns empty array for null value", () => {
      check(mockProjectField, null, []);
    });

    it("returns empty array for undefined value", () => {
      check(mockProjectField, null, []);
    });

    it("extracts ref from string value", () => {
      check(mockProjectField, "project-abc", [
        { fieldPath: ["project"], ref: "project-abc" },
      ]);
    });

    it("extracts ref from tuple value [ref, attrs]", () => {
      check(
        mockProjectField,
        ["project-xyz", { role: "lead" }],
        [{ fieldPath: ["project"], ref: "project-xyz" }],
      );
    });

    it("extracts multiple refs from array of strings", () => {
      check(
        mockOwnersField,
        ["user-1", "user-2", "user-3"],
        [
          { fieldPath: ["owners"], ref: "user-1" },
          { fieldPath: ["owners"], ref: "user-2" },
          { fieldPath: ["owners"], ref: "user-3" },
        ],
      );
    });

    it("extracts multiple refs from array of tuples", () => {
      check(
        mockOwnersField,
        [
          ["user-1", { role: "admin" }],
          ["user-2", { role: "member" }],
        ],
        [
          { fieldPath: ["owners"], ref: "user-1" },
          { fieldPath: ["owners"], ref: "user-2" },
        ],
      );
    });

    it("returns empty array for expanded nested fieldset", () => {
      check(mockProjectField, { uid: "p_abc", title: "Project" }, []);
    });

    it("skips nested fieldsets in multi-value array", () => {
      check(
        mockOwnersField,
        ["user-1", { uid: "u_nested", name: "Nested" }, "user-2"],
        [
          { fieldPath: ["owners"], ref: "user-1" },
          { fieldPath: ["owners"], ref: "user-2" },
        ],
      );
    });
  });

  describe("unistPositionToRange", () => {
    const check = (
      position: UnistPosition,
      expected: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      },
    ) => {
      expect(unistPositionToRange(position)).toEqual(expected);
    };

    it("converts 1-indexed unist position to 0-indexed LSP range", () => {
      check(
        { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
        { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
      );
    });

    it("handles multi-line positions", () => {
      check(
        { start: { line: 5, column: 3 }, end: { line: 7, column: 15 } },
        { start: { line: 4, character: 2 }, end: { line: 6, character: 14 } },
      );
    });
  });

  describe("mapFieldPathToRange", () => {
    const mockMappings: FieldSlotMapping[] = [
      {
        path: ["title"],
        position: {
          start: { line: 3, column: 1 },
          end: { line: 3, column: 20 },
        },
      },
      {
        path: ["project", "name"],
        position: {
          start: { line: 5, column: 5 },
          end: { line: 5, column: 25 },
        },
      },
      {
        path: ["status"],
        position: {
          start: { line: 7, column: 1 },
          end: { line: 7, column: 10 },
        },
      },
    ];

    it("finds range for matching simple path", () => {
      expect(mapFieldPathToRange(["title"], mockMappings)).toEqual({
        start: { line: 2, character: 0 },
        end: { line: 2, character: 19 },
      });
    });

    it("finds range for matching nested path", () => {
      expect(mapFieldPathToRange(["project", "name"], mockMappings)).toEqual({
        start: { line: 4, character: 4 },
        end: { line: 4, character: 24 },
      });
    });

    it("returns undefined for non-matching path", () => {
      expect(
        mapFieldPathToRange(["description"], mockMappings),
      ).toBeUndefined();
    });

    it("returns undefined for partial path match", () => {
      expect(mapFieldPathToRange(["project"], mockMappings)).toBeUndefined();
    });

    it("returns undefined for empty mappings", () => {
      expect(mapFieldPathToRange(["title"], [])).toBeUndefined();
    });
  });

  describe("validateMarkdownFields", () => {
    it("returns empty array for valid fieldset", () => {
      const errors = validateMarkdownFields({
        fieldset: {
          status: "pending",
          favorite: true,
          dueDate: "2024-12-01",
        },
        schema: mockRecordSchema,
        namespace: "record",
      });
      expect(errors).toEqual([]);
    });

    it("returns error for invalid field value", () => {
      const errors = validateMarkdownFields({
        fieldset: {
          status: "invalid-option",
        },
        schema: mockRecordSchema,
        namespace: "record",
      });
      expect(errors).toEqual([
        {
          fieldPath: ["status"],
          code: "invalid-value",
          message: expect.stringContaining("Invalid option value"),
        },
      ]);
    });

    it("skips unknown fields", () => {
      const errors = validateMarkdownFields({
        fieldset: {
          unknownField: "some value",
          status: "pending",
        },
        schema: mockRecordSchema,
        namespace: "record",
      });
      expect(errors).toEqual([]);
    });

    it("skips relation fields (they need existence check)", () => {
      const errors = validateMarkdownFields({
        fieldset: {
          project: "project-ref",
        },
        schema: mockRecordSchema,
        namespace: "record",
      });
      expect(errors).toEqual([]);
    });

    it("validates null as valid for richtext field (empty content)", () => {
      const schemaWithRichtext = {
        ...mockRecordSchema,
        fields: {
          ...mockRecordSchema.fields,
          summary: {
            ...mockNotesField,
            key: "summary" as typeof mockNotesField.key,
            dataType: "richtext" as const,
            richtextFormat: "block" as const,
            allowMultiple: false,
          },
        },
      };
      const errors = validateMarkdownFields({
        fieldset: {
          summary: null,
        },
        schema: schemaWithRichtext,
        namespace: "record",
      });
      expect(errors).toEqual([]);
    });

    it("validates nested richtext fields inside multi-value relations", () => {
      const schemaWithNestedRichtext = {
        ...mockRecordSchema,
        fields: {
          ...mockRecordSchema.fields,
          children: {
            ...mockTasksField,
            key: "children" as typeof mockTasksField.key,
          },
          summary: {
            ...mockNotesField,
            key: "summary" as typeof mockNotesField.key,
            dataType: "richtext" as const,
            richtextFormat: "block" as const,
            allowMultiple: false,
          },
        },
      };
      const errors = validateMarkdownFields({
        fieldset: {
          children: [{ summary: "Valid summary text" }, { summary: "" }],
        },
        schema: schemaWithNestedRichtext,
        namespace: "record",
      });
      expect(errors).toEqual([]);
    });
  });

  describe("collectRelationRefs", () => {
    it("returns empty array for fieldset without relations", () => {
      const refs = collectRelationRefs(
        { status: "pending", favorite: true },
        mockRecordSchema,
      );
      expect(refs).toEqual([]);
    });

    it("collects single relation ref", () => {
      const refs = collectRelationRefs(
        { project: "project-123" },
        mockRecordSchema,
      );
      expect(refs).toEqual([{ fieldPath: ["project"], ref: "project-123" }]);
    });

    it("collects multiple relation refs", () => {
      const refs = collectRelationRefs(
        { owners: ["user-1", "user-2"] },
        mockRecordSchema,
      );
      expect(refs).toEqual([
        { fieldPath: ["owners"], ref: "user-1" },
        { fieldPath: ["owners"], ref: "user-2" },
      ]);
    });

    it("skips expanded nested relations", () => {
      const refs = collectRelationRefs(
        { project: { uid: "p_abc", title: "Expanded Project" } },
        mockRecordSchema,
      );
      expect(refs).toEqual([]);
    });
  });
});

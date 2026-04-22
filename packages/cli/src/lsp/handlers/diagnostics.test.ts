import { describe, expect, it } from "bun:test";
import type { FieldDef, FieldValue, FieldsetNested } from "@binder/repo";
import {
  mockDueDateField,
  mockRecordSchema,
  mockNotesField,
  mockOwnersField,
  mockProjectField,
  mockStatusField,
  mockFavoriteField,
  mockTasksField,
} from "@binder/repo/mocks";
import type { Position as UnistPosition } from "unist";
import type { FieldSlotMapping } from "../../document/view.ts";
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

    it("applies type-level only constraint for option validation", () => {
      const result = validateFieldValue({
        fieldPath: ["status"],
        fieldDef: mockStatusField,
        fieldAttrs: { only: ["pending", "active"] },
        value: "complete",
        namespace: "record",
      });

      expect(result).toEqual({
        fieldPath: ["status"],
        code: "invalid-value",
        message:
          "Invalid value for field 'status': Invalid option value: complete. Expected one of: pending, active",
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

    const check = (
      path: string[],
      expected:
        | {
            start: { line: number; character: number };
            end: { line: number; character: number };
          }
        | undefined,
      mappings = mockMappings,
    ) => {
      expect(mapFieldPathToRange(path, mappings)).toEqual(expected);
    };

    it("finds range for matching simple path", () => {
      check(["title"], {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 19 },
      });
    });

    it("finds range for matching nested path", () => {
      check(["project", "name"], {
        start: { line: 4, character: 4 },
        end: { line: 4, character: 24 },
      });
    });

    it("returns undefined for non-matching path", () => {
      check(["description"], undefined);
    });

    it("returns undefined for partial path match", () => {
      check(["project"], undefined);
    });

    it("returns undefined for empty mappings", () => {
      check(["title"], undefined, []);
    });
  });

  describe("validateMarkdownFields", () => {
    const check = (
      fieldset: FieldsetNested,
      expected: FieldValidationError[],
      opts?: {
        schema?: typeof mockRecordSchema;
        typeDef?: typeof mockRecordSchema.types.Task;
      },
    ) => {
      const schema = opts?.schema ?? mockRecordSchema;
      const typeDef = opts?.typeDef ?? schema.types.Task;
      const errors = validateMarkdownFields({
        fieldset,
        schema,
        namespace: "record",
        typeDef,
      });
      expect(errors).toEqual(expected);
    };

    it("returns empty array for valid fieldset", () => {
      check(
        {
          status: "pending",
          favorite: true,
          dueDate: "2024-12-01",
        },
        [],
      );
    });

    it("returns error for invalid field value", () => {
      check({ status: "invalid-option" }, [
        {
          fieldPath: ["status"],
          code: "invalid-value",
          message: expect.stringContaining("Invalid option value"),
        },
      ]);
    });

    it("applies type-level only constraint for markdown option values", () => {
      const schema = structuredClone(mockRecordSchema);
      schema.types.Task.fields = schema.types.Task.fields.map((ref) =>
        (Array.isArray(ref) ? ref[0] : ref) === "status"
          ? ["status", { only: ["pending", "active"] }]
          : ref,
      );

      check(
        { status: "complete" },
        [
          {
            fieldPath: ["status"],
            code: "invalid-value",
            message: expect.stringContaining("Invalid option value: complete"),
          },
        ],
        { schema },
      );
    });

    it("returns warning for unknown fields with field name and type in message", () => {
      const errors = validateMarkdownFields({
        fieldset: {
          unknownField: "some value",
          status: "pending",
          anotherBadField: 42,
        },
        schema: mockRecordSchema,
        namespace: "record",
        typeDef: mockRecordSchema.types.Task,
      });
      expect(errors.filter((e) => e.code === "unknown-field")).toEqual([
        expect.objectContaining({
          code: "unknown-field",
          message: expect.stringMatching(/unknownField.*Task/),
        }),
        expect.objectContaining({
          code: "unknown-field",
          message: expect.stringMatching(/anotherBadField.*Task/),
        }),
      ]);
    });

    it("skips relation fields (they need existence check)", () => {
      check({ project: "project-ref" }, []);
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

      check({ summary: null }, [], { schema: schemaWithRichtext });
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

      check(
        { children: [{ summary: "Valid summary text" }, { summary: "" }] },
        [],
        { schema: schemaWithNestedRichtext },
      );
    });
  });

  describe("collectRelationRefs", () => {
    const check = (fieldset: FieldsetNested, expected: RelationRef[]) => {
      expect(collectRelationRefs(fieldset, mockRecordSchema)).toEqual(expected);
    };

    it("returns empty array for fieldset without relations", () => {
      check({ status: "pending", favorite: true }, []);
    });

    it("collects single relation ref", () => {
      check({ project: "project-123" }, [
        { fieldPath: ["project"], ref: "project-123" },
      ]);
    });

    it("collects multiple relation refs", () => {
      check({ owners: ["user-1", "user-2"] }, [
        { fieldPath: ["owners"], ref: "user-1" },
        { fieldPath: ["owners"], ref: "user-2" },
      ]);
    });

    it("skips expanded nested relations", () => {
      check({ project: { uid: "p_abc", title: "Expanded Project" } }, []);
    });
  });
});

import { describe, it, expect } from "bun:test";
import { createError, err, okVoid, type JsonValue } from "@binder/utils";
import {
  dataTypeValidators,
  validateDataType,
} from "./data-type-validators.ts";
import "@binder/utils/tests";
import { createUid } from "./utils/uid.ts";
import type { CoreDataType, EntityId, FieldDef } from "./model";

describe("data-type-validators", () => {
  const mockFieldDef = <T extends CoreDataType>(
    dataType: T,
    partial?: Partial<FieldDef<T>>,
  ): FieldDef<T> => ({
    id: 1 as EntityId,
    key: "test",
    name: "Test",
    dataType,
    ...partial,
  });

  describe("seqId", () => {
    it("accepts non-negative integers", () => {
      expect(dataTypeValidators.seqId(0, mockFieldDef("seqId"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.seqId(1, mockFieldDef("seqId"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.seqId(999, mockFieldDef("seqId"))).toEqual(
        okVoid,
      );
    });

    it("rejects negative numbers", () => {
      const result = dataTypeValidators.seqId(-1, mockFieldDef("seqId"));
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("non-negative integer"),
          ),
        ),
      );
    });

    it("rejects decimals", () => {
      const result = dataTypeValidators.seqId(1.5, mockFieldDef("seqId"));
      expect(result).toBeErr();
    });

    it("rejects non-numbers", () => {
      expect(
        dataTypeValidators.seqId("123" as JsonValue, mockFieldDef("seqId")),
      ).toBeErr();
      expect(dataTypeValidators.seqId(null, mockFieldDef("seqId"))).toBeErr();
    });
  });

  describe("uid", () => {
    it("accepts valid UIDs", () => {
      expect(dataTypeValidators.uid(createUid(), mockFieldDef("uid"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.uid(createUid(8), mockFieldDef("uid"))).toEqual(
        okVoid,
      );
    });

    it("rejects invalid UIDs", () => {
      expect(
        dataTypeValidators.uid("not-a-uid", mockFieldDef("uid")),
      ).toBeErr();
      expect(dataTypeValidators.uid("", mockFieldDef("uid"))).toBeErr();
      expect(
        dataTypeValidators.uid(123 as JsonValue, mockFieldDef("uid")),
      ).toBeErr();
    });
  });

  describe("relation", () => {
    it("accepts non-empty strings", () => {
      expect(
        dataTypeValidators.relation("rel-123", mockFieldDef("relation")),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.relation(createUid(), mockFieldDef("relation")),
      ).toEqual(okVoid);
    });

    it("rejects empty strings", () => {
      const result = dataTypeValidators.relation("", mockFieldDef("relation"));
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("non-empty string"),
          ),
        ),
      );
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.relation(123 as JsonValue, mockFieldDef("relation")),
      ).toBeErr();
      expect(
        dataTypeValidators.relation(null, mockFieldDef("relation")),
      ).toBeErr();
    });
  });

  describe("boolean", () => {
    it("accepts booleans", () => {
      expect(dataTypeValidators.boolean(true, mockFieldDef("boolean"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.boolean(false, mockFieldDef("boolean")),
      ).toEqual(okVoid);
    });

    it("rejects non-booleans", () => {
      expect(
        dataTypeValidators.boolean(
          "true" as JsonValue,
          mockFieldDef("boolean"),
        ),
      ).toBeErr();
      expect(
        dataTypeValidators.boolean(1 as JsonValue, mockFieldDef("boolean")),
      ).toBeErr();
      expect(
        dataTypeValidators.boolean(null, mockFieldDef("boolean")),
      ).toBeErr();
    });
  });

  describe("integer", () => {
    it("accepts integers", () => {
      expect(dataTypeValidators.integer(0, mockFieldDef("integer"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.integer(-5, mockFieldDef("integer"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.integer(100, mockFieldDef("integer"))).toEqual(
        okVoid,
      );
    });

    it("rejects decimals", () => {
      const result = dataTypeValidators.integer(1.5, mockFieldDef("integer"));
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("Expected integer"),
          ),
        ),
      );
    });

    it("rejects non-numbers", () => {
      expect(
        dataTypeValidators.integer("123" as JsonValue, mockFieldDef("integer")),
      ).toBeErr();
      expect(
        dataTypeValidators.integer(null, mockFieldDef("integer")),
      ).toBeErr();
    });
  });

  describe("decimal", () => {
    it("accepts numbers", () => {
      expect(dataTypeValidators.decimal(0, mockFieldDef("decimal"))).toEqual(
        okVoid,
      );
      expect(dataTypeValidators.decimal(-5.5, mockFieldDef("decimal"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.decimal(100.123, mockFieldDef("decimal")),
      ).toEqual(okVoid);
    });

    it("rejects NaN", () => {
      expect(
        dataTypeValidators.decimal(NaN, mockFieldDef("decimal")),
      ).toBeErr();
    });

    it("rejects Infinity", () => {
      expect(
        dataTypeValidators.decimal(Infinity, mockFieldDef("decimal")),
      ).toBeErr();
      expect(
        dataTypeValidators.decimal(-Infinity, mockFieldDef("decimal")),
      ).toBeErr();
    });

    it("rejects non-numbers", () => {
      expect(
        dataTypeValidators.decimal(
          "123.45" as JsonValue,
          mockFieldDef("decimal"),
        ),
      ).toBeErr();
      expect(
        dataTypeValidators.decimal(null, mockFieldDef("decimal")),
      ).toBeErr();
    });
  });

  describe("string", () => {
    it("accepts strings", () => {
      expect(dataTypeValidators.string("", mockFieldDef("string"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.string("hello", mockFieldDef("string")),
      ).toEqual(okVoid);
      expect(dataTypeValidators.string("123", mockFieldDef("string"))).toEqual(
        okVoid,
      );
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.string(123 as JsonValue, mockFieldDef("string")),
      ).toBeErr();
      expect(dataTypeValidators.string(null, mockFieldDef("string"))).toBeErr();
      expect(
        dataTypeValidators.string(true as JsonValue, mockFieldDef("string")),
      ).toBeErr();
    });
  });

  describe("text", () => {
    it("accepts strings", () => {
      expect(dataTypeValidators.text("", mockFieldDef("text"))).toEqual(okVoid);
      expect(
        dataTypeValidators.text("long text content", mockFieldDef("text")),
      ).toEqual(okVoid);
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.text(123 as JsonValue, mockFieldDef("text")),
      ).toBeErr();
      expect(dataTypeValidators.text(null, mockFieldDef("text"))).toBeErr();
    });
  });

  describe("date", () => {
    it("accepts ISO date format", () => {
      expect(
        dataTypeValidators.date("2025-01-15", mockFieldDef("date")),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.date("2025-11-03", mockFieldDef("date")),
      ).toEqual(okVoid);
    });

    it("rejects invalid date formats", () => {
      expect(
        dataTypeValidators.date("15-01-2025", mockFieldDef("date")),
      ).toBeErr();
      expect(
        dataTypeValidators.date("2025/01/15", mockFieldDef("date")),
      ).toBeErr();
      expect(
        dataTypeValidators.date("not-a-date", mockFieldDef("date")),
      ).toBeErr();
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.date(20250115 as JsonValue, mockFieldDef("date")),
      ).toBeErr();
    });
  });

  describe("datetime", () => {
    it("accepts ISO timestamp format", () => {
      expect(
        dataTypeValidators.datetime(
          "2025-01-15T10:30:00.000Z",
          mockFieldDef("datetime"),
        ),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.datetime(
          "2025-11-03T14:45:30.123Z",
          mockFieldDef("datetime"),
        ),
      ).toEqual(okVoid);
    });

    it("rejects invalid timestamp formats", () => {
      expect(
        dataTypeValidators.datetime(
          "2025-01-15 10:30:00",
          mockFieldDef("datetime"),
        ),
      ).toBeErr();
      expect(
        dataTypeValidators.datetime(
          "not-a-timestamp",
          mockFieldDef("datetime"),
        ),
      ).toBeErr();
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.datetime(
          1705316400000 as JsonValue,
          mockFieldDef("datetime"),
        ),
      ).toBeErr();
    });
  });

  describe("option", () => {
    it("accepts non-empty strings when no options defined", () => {
      expect(
        dataTypeValidators.option("any-value", mockFieldDef("option")),
      ).toEqual(okVoid);
    });

    it("accepts valid option keys", () => {
      const fieldDef = mockFieldDef("option", {
        options: [
          { key: "active", name: "Active" },
          { key: "inactive", name: "Inactive" },
        ],
      });
      expect(dataTypeValidators.option("active", fieldDef)).toEqual(okVoid);
      expect(dataTypeValidators.option("inactive", fieldDef)).toEqual(okVoid);
    });

    it("rejects invalid option keys", () => {
      const fieldDef = mockFieldDef("option", {
        options: [{ key: "active", name: "Active" }],
      });
      const result = dataTypeValidators.option("invalid", fieldDef);
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("Invalid option value"),
          ),
        ),
      );
    });

    it("rejects empty strings", () => {
      expect(dataTypeValidators.option("", mockFieldDef("option"))).toBeErr();
    });

    it("rejects non-strings", () => {
      expect(
        dataTypeValidators.option(123 as JsonValue, mockFieldDef("option")),
      ).toBeErr();
    });
  });

  describe("object", () => {
    it("accepts objects", () => {
      expect(dataTypeValidators.object({}, mockFieldDef("object"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.object({ key: "value" }, mockFieldDef("object")),
      ).toEqual(okVoid);
    });

    it("rejects arrays", () => {
      expect(dataTypeValidators.object([], mockFieldDef("object"))).toBeErr();
    });

    it("rejects null", () => {
      expect(dataTypeValidators.object(null, mockFieldDef("object"))).toBeErr();
    });

    it("rejects primitives", () => {
      expect(
        dataTypeValidators.object(
          "string" as JsonValue,
          mockFieldDef("object"),
        ),
      ).toBeErr();
      expect(
        dataTypeValidators.object(123 as JsonValue, mockFieldDef("object")),
      ).toBeErr();
    });
  });

  describe("formula", () => {
    it("accepts objects", () => {
      expect(dataTypeValidators.formula({}, mockFieldDef("formula"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.formula(
          { formula: "x + y" },
          mockFieldDef("formula"),
        ),
      ).toEqual(okVoid);
    });

    it("rejects arrays", () => {
      expect(dataTypeValidators.formula([], mockFieldDef("formula"))).toBeErr();
    });

    it("rejects null", () => {
      expect(
        dataTypeValidators.formula(null, mockFieldDef("formula")),
      ).toBeErr();
    });
  });

  describe("condition", () => {
    it("accepts valid filter objects", () => {
      expect(
        dataTypeValidators.condition({}, mockFieldDef("condition")),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.condition(
          {
            title: "Simple Value",
          },
          mockFieldDef("condition"),
        ),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.condition(
          {
            title: { op: "eq", value: "Test" },
          },
          mockFieldDef("condition"),
        ),
      ).toEqual(okVoid);
    });

    it("rejects invalid filter structure", () => {
      const result = dataTypeValidators.condition(
        {
          title: { op: "invalidOp" as any, value: "test" },
        },
        mockFieldDef("condition"),
      );
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("Invalid condition structure"),
          ),
        ),
      );
    });

    it("rejects arrays", () => {
      expect(
        dataTypeValidators.condition([], mockFieldDef("condition")),
      ).toBeErr();
    });

    it("rejects null", () => {
      expect(
        dataTypeValidators.condition(null, mockFieldDef("condition")),
      ).toBeErr();
    });
  });

  describe("query", () => {
    it("accepts valid query objects", () => {
      expect(dataTypeValidators.query({}, mockFieldDef("query"))).toEqual(
        okVoid,
      );
      expect(
        dataTypeValidators.query(
          {
            filters: { title: { op: "eq", value: "Test" } },
          },
          mockFieldDef("query"),
        ),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.query(
          {
            filters: { title: "Simple" },
            orderBy: ["name"],
          },
          mockFieldDef("query"),
        ),
      ).toEqual(okVoid);
    });

    it("rejects invalid query structure", () => {
      const result = dataTypeValidators.query(
        {
          filters: "invalid",
        } as JsonValue,
        mockFieldDef("query"),
      );
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("Invalid query structure"),
          ),
        ),
      );
    });

    it("rejects arrays", () => {
      expect(dataTypeValidators.query([], mockFieldDef("query"))).toBeErr();
    });

    it("rejects null", () => {
      expect(dataTypeValidators.query(null, mockFieldDef("query"))).toBeErr();
    });
  });

  describe("optionSet", () => {
    it("accepts valid option arrays", () => {
      expect(
        dataTypeValidators.optionSet([], mockFieldDef("optionSet")),
      ).toEqual(okVoid);
      expect(
        dataTypeValidators.optionSet(
          [
            { key: "opt1", name: "Option 1" },
            { key: "opt2", name: "Option 2" },
          ],
          mockFieldDef("optionSet"),
        ),
      ).toEqual(okVoid);
    });

    it("rejects non-arrays", () => {
      expect(
        dataTypeValidators.optionSet(
          {} as JsonValue,
          mockFieldDef("optionSet"),
        ),
      ).toBeErr();
    });

    it("rejects arrays with invalid objects", () => {
      const result1 = dataTypeValidators.optionSet(
        [{ key: "opt1" }] as JsonValue,
        mockFieldDef("optionSet"),
      );
      expect(result1).toBeErr();
      expect(result1).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining("expected {key: string, name: string}"),
          ),
        ),
      );

      const result2 = dataTypeValidators.optionSet(
        [{ name: "Option" }] as JsonValue,
        mockFieldDef("optionSet"),
      );
      expect(result2).toBeErr();
    });

    it("rejects arrays with non-objects", () => {
      expect(
        dataTypeValidators.optionSet(
          ["string"] as JsonValue,
          mockFieldDef("optionSet"),
        ),
      ).toBeErr();
      expect(
        dataTypeValidators.optionSet(
          [123] as JsonValue,
          mockFieldDef("optionSet"),
        ),
      ).toBeErr();
    });
  });

  describe("validateDataType", () => {
    it("validates single values", () => {
      const result = validateDataType(mockFieldDef("string"), "test");
      expect(result).toEqual(okVoid);
    });

    it("validates multiple values when allowMultiple is true", () => {
      const result = validateDataType(
        mockFieldDef("string", { allowMultiple: true }),
        ["test1", "test2"],
      );
      expect(result).toEqual(okVoid);
    });

    it("rejects non-array when allowMultiple is true", () => {
      const result = validateDataType(
        mockFieldDef("string", { allowMultiple: true }),
        "test",
      );
      expect(result).toBeErr();
      expect(result).toEqual(
        err(
          createError(
            "validation-error",
            expect.stringContaining(
              "Expected array when allowMultiple is true",
            ),
          ),
        ),
      );
    });

    it("rejects invalid values in array", () => {
      const result = validateDataType(
        mockFieldDef("integer", { allowMultiple: true }),
        [1, 2.5, 3],
      );
      expect(result).toBeErr();
      expect(result).toMatchObject(
        err(
          createError(
            "validation-error",
            expect.stringContaining("Invalid value at index 1"),
          ),
        ),
      );
    });

    it("returns error for unknown data type", () => {
      const result = validateDataType(
        mockFieldDef("unknown" as CoreDataType),
        "test",
      );
      expect(result).toBeErr();
      expect(result).toEqual(
        err(createError("validation-error", "Unknown data type: unknown")),
      );
    });
  });
});

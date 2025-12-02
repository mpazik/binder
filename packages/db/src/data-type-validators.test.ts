import { describe, expect, it } from "bun:test";
import { createError, err, type JsonValue } from "@binder/utils";
import {
  configDataTypeValidators,
  type DataTypeValidator,
  nodeDataTypeValidators,
  validateDataType,
} from "./data-type-validators.ts";
import "@binder/utils/tests";
import { createUid } from "./utils/uid.ts";
import type { EntityId, EntityKey, FieldDef, Namespace } from "./model";

const allValidators = {
  ...nodeDataTypeValidators,
  ...configDataTypeValidators,
};

type AllDataType = keyof typeof allValidators;

describe("data-type-validators", () => {
  const mockFieldDef = <T extends string>(
    dataType: T,
    partial?: Partial<FieldDef<T>>,
  ): FieldDef<T> => ({
    id: 1 as EntityId,
    key: "test" as EntityKey,
    name: "Test",
    dataType,
    ...partial,
  });

  const runValidator = (
    dataType: AllDataType,
    value: JsonValue,
    fieldDefPartial?: Partial<FieldDef<string>>,
  ) => {
    const fieldDef = mockFieldDef(dataType, fieldDefPartial);
    const validator = allValidators[dataType] as DataTypeValidator<string>;
    return validator(value, fieldDef);
  };

  const checkOk = (
    dataType: AllDataType,
    value: JsonValue,
    opts?: { fieldDef?: Partial<FieldDef<string>> },
  ) => {
    expect(runValidator(dataType, value, opts?.fieldDef)).toBeOk();
  };

  const checkErr = (
    dataType: AllDataType,
    value: JsonValue,
    opts?: { fieldDef?: Partial<FieldDef<string>>; message?: string },
  ) => {
    const message = opts?.message
      ? expect.stringContaining(opts.message)
      : expect.any(String);
    expect(runValidator(dataType, value, opts?.fieldDef)).toEqual(
      err(createError("validation-error", message)),
    );
  };

  describe("seqId", () => {
    it("accepts non-negative integers", () => {
      checkOk("seqId", 0);
      checkOk("seqId", 1);
      checkOk("seqId", 999);
    });

    it("rejects negative numbers", () => {
      checkErr("seqId", -1, { message: "non-negative integer" });
    });

    it("rejects decimals", () => {
      checkErr("seqId", 1.5);
    });

    it("rejects non-numbers", () => {
      checkErr("seqId", "123");
      checkErr("seqId", null);
    });
  });

  describe("uid", () => {
    it("accepts valid UIDs", () => {
      checkOk("uid", createUid());
      checkOk("uid", createUid(8));
    });

    it("rejects invalid UIDs", () => {
      checkErr("uid", "not-a-uid");
      checkErr("uid", "");
      checkErr("uid", 123);
    });
  });

  describe("relation", () => {
    it("accepts non-empty strings", () => {
      checkOk("relation", "rel-123");
      checkOk("relation", createUid());
    });

    it("accepts [string, object] tuple format", () => {
      checkOk("relation", ["title", { required: true }]);
      checkOk("relation", ["email", {}]);
    });

    it("rejects empty strings", () => {
      checkErr("relation", "", { message: "non-empty string" });
    });

    it("rejects non-strings", () => {
      checkErr("relation", 123);
      checkErr("relation", null);
    });
  });

  describe("boolean", () => {
    it("accepts booleans", () => {
      checkOk("boolean", true);
      checkOk("boolean", false);
    });

    it("rejects non-booleans", () => {
      checkErr("boolean", "true");
      checkErr("boolean", 1);
      checkErr("boolean", null);
    });
  });

  describe("integer", () => {
    it("accepts integers", () => {
      checkOk("integer", 0);
      checkOk("integer", -5);
      checkOk("integer", 100);
    });

    it("rejects decimals", () => {
      checkErr("integer", 1.5, { message: "Expected integer" });
    });

    it("rejects non-numbers", () => {
      checkErr("integer", "123");
      checkErr("integer", null);
    });
  });

  describe("decimal", () => {
    it("accepts numbers", () => {
      checkOk("decimal", 0);
      checkOk("decimal", -5.5);
      checkOk("decimal", 100.123);
    });

    it("rejects NaN", () => {
      checkErr("decimal", NaN);
    });

    it("rejects Infinity", () => {
      checkErr("decimal", Infinity);
      checkErr("decimal", -Infinity);
    });

    it("rejects non-numbers", () => {
      checkErr("decimal", "123.45");
      checkErr("decimal", null);
    });
  });

  describe("string", () => {
    it("accepts strings", () => {
      checkOk("string", "");
      checkOk("string", "hello");
      checkOk("string", "123");
    });

    it("rejects non-strings", () => {
      checkErr("string", 123);
      checkErr("string", null);
      checkErr("string", true);
    });
  });

  describe("text", () => {
    it("accepts strings", () => {
      checkOk("text", "");
      checkOk("text", "long text content");
    });

    it("rejects non-strings", () => {
      checkErr("text", 123);
      checkErr("text", null);
    });
  });

  describe("date", () => {
    it("accepts ISO date format", () => {
      checkOk("date", "2025-01-15");
      checkOk("date", "2025-11-03");
    });

    it("rejects invalid date formats", () => {
      checkErr("date", "15-01-2025");
      checkErr("date", "2025/01/15");
      checkErr("date", "not-a-date");
    });

    it("rejects non-strings", () => {
      checkErr("date", 20250115);
    });
  });

  describe("datetime", () => {
    it("accepts ISO timestamp format", () => {
      checkOk("datetime", "2025-01-15T10:30:00.000Z");
      checkOk("datetime", "2025-11-03T14:45:30.123Z");
    });

    it("rejects invalid timestamp formats", () => {
      checkErr("datetime", "2025-01-15 10:30:00");
      checkErr("datetime", "not-a-timestamp");
    });

    it("rejects non-strings", () => {
      checkErr("datetime", 1705316400000);
    });
  });

  describe("option", () => {
    it("accepts non-empty strings when no options defined", () => {
      checkOk("option", "any-value");
    });

    it("accepts valid option keys", () => {
      const fieldDef = {
        options: [
          { key: "active", name: "Active" },
          { key: "inactive", name: "Inactive" },
        ],
      };
      checkOk("option", "active", { fieldDef });
      checkOk("option", "inactive", { fieldDef });
    });

    it("rejects invalid option keys", () => {
      checkErr("option", "invalid", {
        fieldDef: { options: [{ key: "active", name: "Active" }] },
        message: "Invalid option value",
      });
    });

    it("rejects empty strings", () => {
      checkErr("option", "");
    });

    it("rejects non-strings", () => {
      checkErr("option", 123);
    });
  });

  describe("object", () => {
    it("accepts objects", () => {
      checkOk("object", {});
      checkOk("object", { key: "value" });
    });

    it("rejects arrays", () => {
      checkErr("object", []);
    });

    it("rejects null", () => {
      checkErr("object", null);
    });

    it("rejects primitives", () => {
      checkErr("object", "string");
      checkErr("object", 123);
    });
  });

  describe("query", () => {
    it("accepts valid query objects", () => {
      checkOk("query", {});
      checkOk("query", { filters: { title: { op: "eq", value: "Test" } } });
      checkOk("query", { filters: { title: "Simple" }, orderBy: ["name"] });
    });

    it("rejects invalid query structure", () => {
      checkErr(
        "query",
        { filters: "invalid" },
        {
          message: "Invalid query structure",
        },
      );
    });

    it("rejects arrays", () => {
      checkErr("query", []);
    });

    it("rejects null", () => {
      checkErr("query", null);
    });
  });

  describe("optionSet", () => {
    it("accepts valid option arrays", () => {
      checkOk("optionSet", []);
      checkOk("optionSet", [
        { key: "opt1", name: "Option 1" },
        { key: "opt2", name: "Option 2" },
      ]);
    });

    it("rejects non-arrays", () => {
      checkErr("optionSet", {});
    });

    it("rejects arrays with invalid objects", () => {
      checkErr("optionSet", [{ key: "opt1" }], {
        message: "expected {key: string, name: string}",
      });
      checkErr("optionSet", [{ name: "Option" }]);
    });

    it("rejects arrays with non-objects", () => {
      checkErr("optionSet", ["string"]);
      checkErr("optionSet", [123]);
    });
  });

  describe("validateDataType", () => {
    const checkOk = (
      dataType: AllDataType,
      value: JsonValue,
      opts?: {
        namespace?: Namespace;
        fieldDef?: Partial<FieldDef<AllDataType>>;
      },
    ) => {
      const result = validateDataType(
        opts?.namespace ?? "node",
        mockFieldDef(dataType, opts?.fieldDef),
        value,
      );
      expect(result).toBeOk();
    };

    const checkErr = (
      dataType: AllDataType,
      value: JsonValue,
      opts?: {
        namespace?: Namespace;
        fieldDef?: Partial<FieldDef<AllDataType>>;
        message?: string;
      },
    ) => {
      const result = validateDataType(
        opts?.namespace ?? "node",
        mockFieldDef(dataType, opts?.fieldDef),
        value,
      );
      const message = opts?.message
        ? expect.stringContaining(opts.message)
        : expect.any(String);
      expect(result).toMatchObject(
        err(createError("validation-error", message)),
      );
    };

    it("validates single values", () => {
      checkOk("string", "test");
    });

    it("validates multiple values when allowMultiple is true", () => {
      checkOk("string", ["test1", "test2"], {
        fieldDef: { allowMultiple: true },
      });
    });

    it("rejects non-array when allowMultiple is true", () => {
      checkErr("string", "test", {
        fieldDef: { allowMultiple: true },
        message: "Expected array when allowMultiple is true",
      });
    });

    it("rejects invalid values in array", () => {
      checkErr("integer", [1, 2.5, 3], {
        fieldDef: { allowMultiple: true },
        message: "Invalid value at index 1",
      });
    });

    it("returns error for unknown data type", () => {
      checkErr("unknown" as AllDataType, "test", {
        message: "Unknown data type: unknown",
      });
    });
  });
});

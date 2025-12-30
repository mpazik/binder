import { describe, expect, it } from "bun:test";
import { type JsonValue, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  formatFieldValue,
  getNestedValue,
  parseFieldValue,
  setNestedValue,
} from "./field.ts";
import type { FieldDef, FieldsetNested } from "./index.ts";

describe("field-value", () => {
  describe("parseFieldValue", () => {
    const check = (
      raw: string,
      fieldDef: Pick<FieldDef, "dataType" | "allowMultiple">,
      expected: JsonValue,
    ) => {
      const result = throwIfError(parseFieldValue(raw, fieldDef));
      expect(result).toEqual(expected);
    };

    it("parses string values", () => {
      check("hello", { dataType: "plaintext" }, "hello");
      check("  hello  ", { dataType: "plaintext" }, "hello");
    });

    it("parses text values", () => {
      check("some text", { dataType: "richtext" }, "some text");
    });

    it("parses empty string as null", () => {
      check("", { dataType: "plaintext" }, null);
      check("   ", { dataType: "plaintext" }, null);
    });

    it("parses integer values", () => {
      check("123", { dataType: "integer" }, 123);
      check("  456  ", { dataType: "integer" }, 456);
      check("-42", { dataType: "integer" }, -42);
    });

    it("returns error for invalid integer", () => {
      const result = parseFieldValue("abc", { dataType: "integer" });
      expect(result).toBeErr();
    });

    it("parses seqId values", () => {
      check("789", { dataType: "seqId" }, 789);
    });

    it("parses decimal values", () => {
      check("3.14", { dataType: "decimal" }, 3.14);
      check("-2.5", { dataType: "decimal" }, -2.5);
      check("5", { dataType: "decimal" }, 5);
    });

    it("returns error for invalid decimal", () => {
      const result = parseFieldValue("not-a-number", { dataType: "decimal" });
      expect(result).toBeErr();
    });

    it("parses boolean true values", () => {
      check("true", { dataType: "boolean" }, true);
      check("True", { dataType: "boolean" }, true);
      check("TRUE", { dataType: "boolean" }, true);
      check("yes", { dataType: "boolean" }, true);
      check("Yes", { dataType: "boolean" }, true);
      check("on", { dataType: "boolean" }, true);
      check("ON", { dataType: "boolean" }, true);
      check("1", { dataType: "boolean" }, true);
    });

    it("parses boolean false values", () => {
      check("false", { dataType: "boolean" }, false);
      check("False", { dataType: "boolean" }, false);
      check("FALSE", { dataType: "boolean" }, false);
      check("no", { dataType: "boolean" }, false);
      check("No", { dataType: "boolean" }, false);
      check("off", { dataType: "boolean" }, false);
      check("OFF", { dataType: "boolean" }, false);
      check("0", { dataType: "boolean" }, false);
    });

    it("returns error for invalid boolean", () => {
      const result = parseFieldValue("maybe", { dataType: "boolean" });
      expect(result).toBeErr();
    });

    it("parses date values as string", () => {
      check("2024-01-15", { dataType: "date" }, "2024-01-15");
    });

    it("parses datetime values as string", () => {
      check(
        "2024-01-15T10:30:00Z",
        { dataType: "datetime" },
        "2024-01-15T10:30:00Z",
      );
    });

    it("parses relation values as string", () => {
      check("u_abc123", { dataType: "relation" }, "u_abc123");
    });

    describe("allowMultiple", () => {
      it("parses comma-separated values into array", () => {
        check("a, b, c", { dataType: "plaintext", allowMultiple: true }, [
          "a",
          "b",
          "c",
        ]);
      });

      it("trims whitespace from each item", () => {
        check(
          "  foo  ,  bar  ",
          { dataType: "plaintext", allowMultiple: true },
          ["foo", "bar"],
        );
      });

      it("returns empty array for empty string", () => {
        check("", { dataType: "plaintext", allowMultiple: true }, []);
        check("   ", { dataType: "plaintext", allowMultiple: true }, []);
      });

      it("handles single value", () => {
        check("single", { dataType: "plaintext", allowMultiple: true }, [
          "single",
        ]);
      });
    });
  });

  describe("formatFieldValue", () => {
    it("formats null as empty string", () => {
      expect(formatFieldValue(null)).toBe("");
    });

    it("formats undefined as empty string", () => {
      expect(formatFieldValue(undefined)).toBe("");
    });

    it("formats string values", () => {
      expect(formatFieldValue("hello")).toBe("hello");
    });

    it("formats number values", () => {
      expect(formatFieldValue(123)).toBe("123");
      expect(formatFieldValue(3.14)).toBe("3.14");
    });

    it("formats boolean values", () => {
      expect(formatFieldValue(true)).toBe("true");
      expect(formatFieldValue(false)).toBe("false");
    });

    it("formats empty array as empty string", () => {
      expect(formatFieldValue([])).toBe("");
    });

    it("formats array as comma-separated string", () => {
      expect(formatFieldValue(["a", "b", "c"])).toBe("a, b, c");
    });

    it("formats single-element array", () => {
      expect(formatFieldValue(["single"])).toBe("single");
    });
  });

  describe("getNestedValue", () => {
    it("gets top-level value", () => {
      expect(getNestedValue({ name: "John" }, ["name"])).toBe("John");
    });

    it("gets nested value", () => {
      const fieldset = { user: { name: "John", age: 30 } };
      expect(getNestedValue(fieldset, ["user", "name"])).toBe("John");
    });

    it("gets deeply nested value", () => {
      const fieldset = { a: { b: { c: { d: "deep" } } } };
      expect(getNestedValue(fieldset, ["a", "b", "c", "d"])).toBe("deep");
    });

    it("returns undefined for missing key", () => {
      expect(getNestedValue({ name: "John" }, ["missing"])).toBeUndefined();
    });

    it("returns undefined for missing nested key", () => {
      const fieldset = { user: { name: "John" } };
      expect(getNestedValue(fieldset, ["user", "missing"])).toBeUndefined();
    });

    it("returns undefined when path goes through non-object", () => {
      const fieldset = { name: "John" };
      expect(getNestedValue(fieldset, ["name", "nested"])).toBeUndefined();
    });

    it("returns undefined when path goes through null", () => {
      const fieldset: FieldsetNested = { user: null };
      expect(getNestedValue(fieldset, ["user", "name"])).toBeUndefined();
    });

    it("returns undefined when path goes through array", () => {
      const fieldset: FieldsetNested = { items: ["a", "b"] };
      expect(getNestedValue(fieldset, ["items", "0"])).toBeUndefined();
    });

    it("returns the fieldset itself for empty path", () => {
      const fieldset = { name: "John" };
      expect(getNestedValue(fieldset, [])).toEqual({ name: "John" });
    });
  });

  describe("setNestedValue", () => {
    it("sets top-level value", () => {
      const fieldset: FieldsetNested = {};
      setNestedValue(fieldset, ["name"], "John");
      expect(fieldset).toEqual({ name: "John" });
    });

    it("sets nested value", () => {
      const fieldset: FieldsetNested = {};
      setNestedValue(fieldset, ["user", "name"], "John");
      expect(fieldset).toEqual({ user: { name: "John" } });
    });

    it("sets deeply nested value", () => {
      const fieldset: FieldsetNested = {};
      setNestedValue(fieldset, ["a", "b", "c"], "deep");
      expect(fieldset).toEqual({ a: { b: { c: "deep" } } });
    });

    it("overwrites existing value", () => {
      const fieldset: FieldsetNested = { name: "John" };
      setNestedValue(fieldset, ["name"], "Jane");
      expect(fieldset).toEqual({ name: "Jane" });
    });

    it("preserves existing siblings", () => {
      const fieldset: FieldsetNested = { user: { name: "John", age: 30 } };
      setNestedValue(fieldset, ["user", "name"], "Jane");
      expect(fieldset).toEqual({ user: { name: "Jane", age: 30 } });
    });

    it("does nothing for empty path", () => {
      const fieldset: FieldsetNested = { name: "John" };
      setNestedValue(fieldset, [], "ignored");
      expect(fieldset).toEqual({ name: "John" });
    });
  });
});

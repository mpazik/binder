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
import {
  mockAliasesField,
  mockChaptersField,
  mockDueDateField,
  mockFavoriteField,
  mockNotesField,
  mockPriorityField,
  mockStepsField,
  mockTagsField,
  mockTemplatesField,
} from "./config.mock.ts";
import { coreFields } from "./schema.ts";

describe("field-value", () => {
  describe("parseFieldValue", () => {
    const check = (raw: string, fieldDef: FieldDef, expected: JsonValue) => {
      const result = throwIfError(parseFieldValue(raw, fieldDef));
      expect(result).toEqual(expected);
    };

    it("parses string values", () => {
      check("hello", coreFields.name, "hello");
      check("  hello  ", coreFields.name, "hello");
    });

    it("parses text values", () => {
      check("some text", coreFields.description, "some text");
    });

    it("parses empty string as null", () => {
      check("", coreFields.name, null);
      check("   ", coreFields.name, null);
    });

    it("parses integer values", () => {
      check("123", coreFields.id, 123);
      check("  456  ", coreFields.id, 456);
    });

    it("returns error for invalid integer", () => {
      const result = parseFieldValue("abc", coreFields.id);
      expect(result).toBeErr();
    });

    it("parses seqId values", () => {
      check("789", coreFields.id, 789);
    });

    it("parses decimal values", () => {
      const decimalField = {
        ...coreFields.id,
        dataType: "decimal",
      } as FieldDef;
      check("3.14", decimalField, 3.14);
      check("-2.5", decimalField, -2.5);
      check("5", decimalField, 5);
    });

    it("returns error for invalid decimal", () => {
      const decimalField = {
        ...coreFields.id,
        dataType: "decimal",
      } as FieldDef;
      const result = parseFieldValue("not-a-number", decimalField);
      expect(result).toBeErr();
    });

    it("parses boolean true values", () => {
      check("true", mockFavoriteField, true);
      check("True", mockFavoriteField, true);
      check("TRUE", mockFavoriteField, true);
      check("yes", mockFavoriteField, true);
      check("Yes", mockFavoriteField, true);
      check("on", mockFavoriteField, true);
      check("ON", mockFavoriteField, true);
      check("1", mockFavoriteField, true);
    });

    it("parses boolean false values", () => {
      check("false", mockFavoriteField, false);
      check("False", mockFavoriteField, false);
      check("FALSE", mockFavoriteField, false);
      check("no", mockFavoriteField, false);
      check("No", mockFavoriteField, false);
      check("off", mockFavoriteField, false);
      check("OFF", mockFavoriteField, false);
      check("0", mockFavoriteField, false);
    });

    it("returns error for invalid boolean", () => {
      const result = parseFieldValue("maybe", mockFavoriteField);
      expect(result).toBeErr();
    });

    it("parses date values as string", () => {
      check("2024-01-15", mockDueDateField, "2024-01-15");
    });

    it("parses option values as string", () => {
      check("high", mockPriorityField, "high");
    });

    describe("allowMultiple with code alphabet", () => {
      it("splits by comma", () => {
        check("urgent, important, low-priority", mockTagsField, [
          "urgent",
          "important",
          "low-priority",
        ]);
      });

      it("trims whitespace from each item", () => {
        check("  foo  ,  bar  ", mockTagsField, ["foo", "bar"]);
      });

      it("returns empty array for empty string", () => {
        check("", mockTagsField, []);
        check("   ", mockTagsField, []);
      });

      it("handles single value", () => {
        check("single", mockTagsField, ["single"]);
      });
    });

    describe("allowMultiple with line alphabet", () => {
      it("splits by newline", () => {
        check("first alias\nsecond alias\nthird", mockAliasesField, [
          "first alias",
          "second alias",
          "third",
        ]);
      });

      it("trims whitespace from each item", () => {
        check("  foo  \n  bar  ", mockAliasesField, ["foo", "bar"]);
      });

      it("returns empty array for empty string", () => {
        check("", mockAliasesField, []);
        check("   ", mockAliasesField, []);
      });

      it("handles single value", () => {
        check("single alias", mockAliasesField, ["single alias"]);
      });
    });

    describe("allowMultiple with paragraph alphabet", () => {
      it("splits by blank line", () => {
        check(
          "first paragraph\nwith two lines\n\nsecond paragraph",
          mockNotesField,
          ["first paragraph\nwith two lines", "second paragraph"],
        );
      });

      it("handles empty values", () => {
        check("", mockNotesField, []);
      });

      it("trims whitespace from items", () => {
        check("  first para  \n\n  second para  ", mockNotesField, [
          "first para",
          "second para",
        ]);
      });
    });

    describe("allowMultiple with block alphabet", () => {
      it("splits by blank line", () => {
        check("first block\nwith lines\n\nsecond block", mockStepsField, [
          "first block\nwith lines",
          "second block",
        ]);
      });
    });

    describe("allowMultiple with section alphabet", () => {
      it("splits by headers", () => {
        check(
          "## Chapter One\nContent here\n\n## Chapter Two\nMore content",
          mockChaptersField,
          ["## Chapter One\nContent here", "## Chapter Two\nMore content"],
        );
      });

      it("splits by any header level", () => {
        check(
          "# H1\nContent\n\n### H3\nMore\n\n###### H6\nEnd",
          mockChaptersField,
          ["# H1\nContent", "### H3\nMore", "###### H6\nEnd"],
        );
      });

      it("includes content before first header as separate section", () => {
        check("Intro content\n\n## First Chapter\nBody", mockChaptersField, [
          "Intro content",
          "## First Chapter\nBody",
        ]);
      });

      it("handles content with no headers", () => {
        check("Just plain content\n\nWith paragraphs", mockChaptersField, [
          "Just plain content\n\nWith paragraphs",
        ]);
      });

      it("handles empty content", () => {
        check("", mockChaptersField, []);
      });

      it("trims whitespace from items", () => {
        check(
          "  \n## Chapter One\nContent  \n\n## Chapter Two\nMore  \n  ",
          mockChaptersField,
          ["## Chapter One\nContent", "## Chapter Two\nMore"],
        );
      });

      it("does not split on hash without space (not a header)", () => {
        check(
          "## Chapter\nContent with #hashtag\n\n## Another",
          mockChaptersField,
          ["## Chapter\nContent with #hashtag", "## Another"],
        );
      });
    });

    describe("allowMultiple with document alphabet", () => {
      it("splits by horizontal rule", () => {
        check(
          "# First Doc\nContent here\n---\n# Second Doc\nMore content",
          mockTemplatesField,
          ["# First Doc\nContent here", "# Second Doc\nMore content"],
        );
      });

      it("handles multiple horizontal rules", () => {
        check("doc1\n---\ndoc2\n---\ndoc3", mockTemplatesField, [
          "doc1",
          "doc2",
          "doc3",
        ]);
      });

      it("handles content with headers", () => {
        check(
          "# Title\n## Section\nContent\n---\n# Another\n### Sub",
          mockTemplatesField,
          ["# Title\n## Section\nContent", "# Another\n### Sub"],
        );
      });

      it("handles empty content", () => {
        check("", mockTemplatesField, []);
      });

      it("trims whitespace from items", () => {
        check("  doc1  \n---\n  doc2  ", mockTemplatesField, ["doc1", "doc2"]);
      });

      it("handles single document without separator", () => {
        check("# Single Doc\nWith content", mockTemplatesField, [
          "# Single Doc\nWith content",
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

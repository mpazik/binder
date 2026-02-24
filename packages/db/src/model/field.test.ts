import { describe, expect, it } from "bun:test";
import { type JsonValue, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { getNestedValue, setNestedValue } from "./field.ts";
import { parseFieldValue, stringifyFieldValue } from "./text-format.ts";
import type { FieldDef, FieldsetNested } from "./index.ts";
import {
  mockAliasesField,
  mockDueDateField,
  mockFavoriteField,
  mockNotesField,
  mockPriorityField,
  mockStepsField,
  mockTagsField,
  mockTemplatesField,
} from "./config.mock.ts";
import { coreFields } from "./schema.ts";

// Test-only field definition for section format parsing tests
const mockSectionField = {
  dataType: "richtext",
  richtextFormat: "section",
  allowMultiple: true,
} as FieldDef;

describe("field", () => {
  describe("getNestedValue", () => {
    const check = (
      fieldset: FieldsetNested,
      path: string[],
      expected: JsonValue | undefined,
    ) => {
      expect(getNestedValue(fieldset, path)).toEqual(expected);
    };

    it("gets top-level value", () => {
      check({ name: "John" }, ["name"], "John");
    });

    it("gets nested value", () => {
      check({ user: { name: "John", age: 30 } }, ["user", "name"], "John");
    });

    it("gets deeply nested value", () => {
      check({ a: { b: { c: { d: "deep" } } } }, ["a", "b", "c", "d"], "deep");
    });

    it("returns undefined for missing key", () => {
      check({ name: "John" }, ["missing"], undefined);
    });

    it("returns undefined for missing nested key", () => {
      check({ user: { name: "John" } }, ["user", "missing"], undefined);
    });

    it("returns undefined when path goes through non-object", () => {
      check({ name: "John" }, ["name", "nested"], undefined);
    });

    it("returns undefined when path goes through null", () => {
      check({ user: null }, ["user", "name"], undefined);
    });

    it("returns undefined when path goes through array", () => {
      check({ items: ["a", "b"] }, ["items", "0"], undefined);
    });

    it("returns the fieldset itself for empty path", () => {
      check({ name: "John" }, [], { name: "John" });
    });
  });

  describe("setNestedValue", () => {
    const check = (
      initial: FieldsetNested,
      path: string[],
      value: JsonValue,
      expected: FieldsetNested,
    ) => {
      setNestedValue(initial, path, value);
      expect(initial).toEqual(expected);
    };

    it("sets top-level value", () => {
      check({}, ["name"], "John", { name: "John" });
    });

    it("sets nested value", () => {
      check({}, ["user", "name"], "John", { user: { name: "John" } });
    });

    it("sets deeply nested value", () => {
      check({}, ["a", "b", "c"], "deep", { a: { b: { c: "deep" } } });
    });

    it("overwrites existing value", () => {
      check({ name: "John" }, ["name"], "Jane", { name: "Jane" });
    });

    it("preserves existing siblings", () => {
      check({ user: { name: "John", age: 30 } }, ["user", "name"], "Jane", {
        user: { name: "Jane", age: 30 },
      });
    });

    it("does nothing for empty path", () => {
      check({ name: "John" }, [], "ignored", { name: "John" });
    });
  });

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

    describe("allowMultiple with identifier format", () => {
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

    describe("allowMultiple with inline format", () => {
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

    describe("allowMultiple with paragraph format", () => {
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

    describe("allowMultiple with block format", () => {
      it("splits by blank line", () => {
        check("first block\nwith lines\n\nsecond block", mockStepsField, [
          "first block\nwith lines",
          "second block",
        ]);
      });
    });

    describe("allowMultiple with section format", () => {
      it("splits by headers", () => {
        check(
          "## Chapter One\nContent here\n\n## Chapter Two\nMore content",
          mockSectionField,
          ["## Chapter One\nContent here", "## Chapter Two\nMore content"],
        );
      });

      it("splits by any header level", () => {
        check(
          "# H1\nContent\n\n### H3\nMore\n\n###### H6\nEnd",
          mockSectionField,
          ["# H1\nContent", "### H3\nMore", "###### H6\nEnd"],
        );
      });

      it("includes content before first header as separate section", () => {
        check("Intro content\n\n## First Chapter\nBody", mockSectionField, [
          "Intro content",
          "## First Chapter\nBody",
        ]);
      });

      it("handles content with no headers", () => {
        check("Just plain content\n\nWith paragraphs", mockSectionField, [
          "Just plain content\n\nWith paragraphs",
        ]);
      });

      it("handles empty content", () => {
        check("", mockSectionField, []);
      });

      it("trims whitespace from items", () => {
        check(
          "  \n## Chapter One\nContent  \n\n## Chapter Two\nMore  \n  ",
          mockSectionField,
          ["## Chapter One\nContent", "## Chapter Two\nMore"],
        );
      });

      it("does not split on hash without space (not a header)", () => {
        check(
          "## Chapter\nContent with #hashtag\n\n## Another",
          mockSectionField,
          ["## Chapter\nContent with #hashtag", "## Another"],
        );
      });
    });

    describe("allowMultiple with document format", () => {
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

  describe("stringifyFieldValue", () => {
    const check = (
      value: JsonValue | undefined,
      fieldDef: FieldDef,
      expected: string,
    ) => {
      expect(stringifyFieldValue(value, fieldDef)).toBe(expected);
    };

    it("formats null as empty string", () => {
      check(null, mockTagsField, "");
    });

    it("formats undefined as empty string", () => {
      check(undefined, mockTagsField, "");
    });

    it("formats string values", () => {
      check("hello", mockTagsField, "hello");
    });

    it("formats number values", () => {
      check(123, coreFields.id, "123");
      check(
        3.14,
        { ...coreFields.id, dataType: "decimal" } as FieldDef,
        "3.14",
      );
    });

    it("formats boolean values", () => {
      check(true, mockFavoriteField, "true");
      check(false, mockFavoriteField, "false");
    });

    it("formats empty array as empty string", () => {
      check([], mockTagsField, "");
    });

    it("formats array with comma delimiter", () => {
      check(["a", "b", "c"], mockTagsField, "a, b, c");
    });

    it("formats array with newline delimiter", () => {
      check(["a", "b"], mockAliasesField, "a\nb");
    });

    it("formats array with blankline delimiter", () => {
      check(["para1", "para2"], mockNotesField, "para1\n\npara2");
    });

    it("formats single-element array", () => {
      check(["single"], mockTagsField, "single");
    });

    describe("parse/stringify round-trip", () => {
      const checkRoundtrip = (values: string[], fieldDef: FieldDef) => {
        const stringified = stringifyFieldValue(values, fieldDef);
        const parsed = throwIfError(parseFieldValue(stringified, fieldDef));
        expect(parsed).toEqual(values);
      };

      it("round-trips comma-separated values", () => {
        checkRoundtrip(["a", "b", "c"], mockTagsField);
      });

      it("round-trips newline-separated values", () => {
        checkRoundtrip(["first", "second"], mockAliasesField);
      });
    });
  });
});

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

  describe("plaintext", () => {
    it("accepts strings", () => {
      checkOk("plaintext", "");
      checkOk("plaintext", "hello");
      checkOk("plaintext", "123");
    });

    it("rejects non-strings", () => {
      checkErr("plaintext", 123);
      checkErr("plaintext", null);
      checkErr("plaintext", true);
    });

    it("uses line alphabet by default - rejects line breaks", () => {
      checkErr("plaintext", "hello\nworld", {
        message: "single line without line breaks",
      });
    });

    it("accepts single line with default alphabet", () => {
      checkOk("plaintext", "hello world with spaces");
    });

    describe("alphabet: token", () => {
      const fieldDef = { plaintextFormat: "token" as const };

      it("accepts letters and digits", () => {
        checkOk("plaintext", "abc123", { fieldDef });
        checkOk("plaintext", "", { fieldDef });
      });

      it("rejects spaces", () => {
        checkErr("plaintext", "abc 123", {
          fieldDef,
          message: "only letters and digits",
        });
      });

      it("rejects special characters", () => {
        checkErr("plaintext", "abc-123", { fieldDef });
        checkErr("plaintext", "abc_123", { fieldDef });
      });
    });

    describe("alphabet: code", () => {
      const fieldDef = { plaintextFormat: "code" as const };

      it("accepts valid code identifiers", () => {
        checkOk("plaintext", "myItem", { fieldDef });
        checkOk("plaintext", "my-item_v2", { fieldDef });
        checkOk("plaintext", "", { fieldDef });
      });

      it("rejects codes starting with digit", () => {
        checkErr("plaintext", "123abc", {
          fieldDef,
          message: "start with a letter",
        });
      });

      it("rejects codes starting with special char", () => {
        checkErr("plaintext", "-item", { fieldDef });
        checkErr("plaintext", "_item", { fieldDef });
      });
    });

    describe("alphabet: word", () => {
      const fieldDef = { plaintextFormat: "word" as const };

      it("accepts words without whitespace", () => {
        checkOk("plaintext", "hello", { fieldDef });
        checkOk("plaintext", "hello-world", { fieldDef });
        checkOk("plaintext", "", { fieldDef });
      });

      it("rejects words with spaces", () => {
        checkErr("plaintext", "hello world", {
          fieldDef,
          message: "single word without whitespace",
        });
      });

      it("rejects words with tabs", () => {
        checkErr("plaintext", "hello\tworld", { fieldDef });
      });
    });

    describe("alphabet: paragraph", () => {
      const fieldDef = { plaintextFormat: "paragraph" as const };

      it("accepts multiple lines without blank lines", () => {
        checkOk("plaintext", "line1\nline2\nline3", { fieldDef });
        checkOk("plaintext", "", { fieldDef });
      });

      it("rejects blank lines", () => {
        checkErr("plaintext", "para1\n\npara2", {
          fieldDef,
          message: "must not contain blank lines",
        });
      });
    });
  });

  describe("richtext", () => {
    it("accepts strings", () => {
      checkOk("richtext", "");
      checkOk("richtext", "long text content");
    });

    it("rejects non-strings", () => {
      checkErr("richtext", 123);
      checkErr("richtext", null);
    });

    it("uses block alphabet by default - rejects blank lines", () => {
      checkErr("richtext", "para1\n\npara2", {
        message: "must not contain blank lines",
      });
    });

    describe("alphabet: word", () => {
      const fieldDef = { richtextFormat: "word" as const };

      it("accepts single words", () => {
        checkOk("richtext", "hello", { fieldDef });
        checkOk("richtext", "", { fieldDef });
      });

      it("rejects spaces", () => {
        checkErr("richtext", "hello world", {
          fieldDef,
          message: "single word without whitespace",
        });
      });
    });

    describe("alphabet: line", () => {
      const fieldDef = { richtextFormat: "line" as const };

      it("accepts single lines with formatting", () => {
        checkOk("richtext", "hello **world**", { fieldDef });
        checkOk("richtext", "", { fieldDef });
      });

      it("rejects line breaks", () => {
        checkErr("richtext", "line1\nline2", {
          fieldDef,
          message: "single line without line breaks",
        });
      });
    });

    describe("alphabet: block", () => {
      const fieldDef = { richtextFormat: "block" as const };

      it("accepts paragraphs and lists", () => {
        checkOk("richtext", "paragraph content", { fieldDef });
        checkOk("richtext", "- item 1\n- item 2", { fieldDef });
        checkOk("richtext", "", { fieldDef });
      });

      it("rejects blank lines", () => {
        checkErr("richtext", "para1\n\npara2", {
          fieldDef,
          message: "must not contain blank lines",
        });
      });

      it("rejects headers", () => {
        checkErr("richtext", "# Heading", {
          fieldDef,
          message: "cannot contain headers",
        });
        checkErr("richtext", "## Heading", { fieldDef });
        checkErr("richtext", "### Heading", { fieldDef });
      });

      it("rejects headers in multiline content", () => {
        checkErr("richtext", "content\n## Heading\nmore content", { fieldDef });
      });

      it("allows hash without space (not a header)", () => {
        checkOk("richtext", "#hashtag", { fieldDef });
        checkOk("richtext", "##not-a-header", { fieldDef });
      });
    });

    describe("alphabet: section", () => {
      const fieldDef = { richtextFormat: "section" as const };

      it("accepts content with blank lines", () => {
        checkOk("richtext", "paragraph\n\nanother paragraph", { fieldDef });
        checkOk("richtext", "", { fieldDef });
      });

      it("rejects headers", () => {
        checkErr("richtext", "# Heading\n\nContent", {
          fieldDef,
          message: "cannot contain headers",
        });
        checkErr("richtext", "## Sub heading", { fieldDef });
      });
    });

    describe("alphabet: document", () => {
      const fieldDef = { richtextFormat: "document" as const };

      it("accepts content with headers", () => {
        checkOk("richtext", "# Heading\n\nContent", { fieldDef });
        checkOk("richtext", "## Sub heading\n\nMore content", { fieldDef });
        checkOk("richtext", "# Title\nContent\n## Another", { fieldDef });
      });

      it("accepts content with blank lines", () => {
        checkOk("richtext", "paragraph\n\nanother paragraph", { fieldDef });
      });

      it("rejects horizontal rules", () => {
        checkErr("richtext", "section1\n---\nsection2", {
          fieldDef,
          message: "cannot contain horizontal rules",
        });
        checkErr("richtext", "# Title\n---\ncontent", { fieldDef });
      });
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

    it("accepts string shorthand for options", () => {
      checkOk("optionSet", ["opt1", "opt2"]);
      checkOk("optionSet", [{ key: "opt1" }, "opt2"]);
    });

    it("rejects non-arrays", () => {
      checkErr("optionSet", {});
    });

    it("rejects arrays with invalid objects", () => {
      checkErr("optionSet", [{ name: "Option" }], {
        message: "expected {key: string}",
      });
    });

    it("rejects arrays with invalid values", () => {
      checkErr("optionSet", [123]);
      checkErr("optionSet", [""]);
      checkErr("optionSet", [null]);
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
      checkOk("plaintext", "test");
    });

    it("validates multiple values when allowMultiple is true", () => {
      checkOk("plaintext", ["test1", "test2"], {
        fieldDef: { allowMultiple: true },
      });
    });

    it("rejects non-array when allowMultiple is true", () => {
      checkErr("plaintext", "test", {
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

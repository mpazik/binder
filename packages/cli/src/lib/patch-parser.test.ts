import { expect, it, describe } from "bun:test";
import "@binder/utils/tests";
import { coreFields, type FieldChangeInput, type FieldDef } from "@binder/db";
import {
  mockAliasesField,
  mockFavoriteField,
  mockRecordSchema,
  mockNotesField,
  mockPriceField,
  mockStepsField,
} from "@binder/db/mocks";
import { isErr } from "@binder/utils";
import { parseFieldChange, parsePatches } from "./patch-parser.ts";

describe("patch-parser", () => {
  const check = (
    patch: string,
    expected: FieldChangeInput,
    fieldDef: FieldDef = coreFields.title,
  ) => {
    const result = parseFieldChange(patch, fieldDef);
    expect(result).toBeOkWith(expected);
  };

  const checkWithSchema = (
    patches: string[],
    expected: Record<string, FieldChangeInput>,
  ) => {
    const result = parsePatches(patches, mockRecordSchema);
    expect(result).toBeOkWith(expected);
  };

  it("parses boolean", () => {
    check("favorite=true", true, mockFavoriteField);
    check("favorite=false", false, mockFavoriteField);
  });

  it("parses integer", () => {
    check("field=42", 42, coreFields.id);
    check("field=-10", -10, coreFields.id);
  });

  it("parses decimal", () => {
    check("price=3.14", 3.14, mockPriceField);
    check("price=-2.5", -2.5, mockPriceField);
  });

  it("parses string", () => {
    check("title=hello", "hello");
    check("title=hello world", "hello world");
    check("title=null", "null");
  });

  it("parses empty string as null", () => {
    check("title=", null);
    check('title=""', null);
  });

  it("parses file path values", () => {
    check("title=docs/intro.md", "docs/intro.md");
    check("title=person/jan", "person/jan");
  });

  it("parses JSON object", () => {
    check('field={"key":"value"}', { key: "value" });
    check("field={}", {});
    check('field={"a":1,"b":2}', { a: 1, b: 2 });
    check('field={"arr":[1,2,3],"obj":{"nested":true}}', {
      arr: [1, 2, 3],
      obj: { nested: true },
    });
  });

  describe("array operations", () => {
    it("sets array with JSON/YAML", () => {
      check('field=["a","b","c"]', ["a", "b", "c"]);
      check("field=[]", []);
      check("field=[1,2,3]", [1, 2, 3]);
      check("field=[true,false,null]", [true, false, null]);
      check("field=[a, b, c]", ["a", "b", "c"]);
    });

    it("sets array of objects", () => {
      check(
        'options=[{"key":"draft","name":"Draft"},{"key":"active","name":"Active"}]',
        [
          { key: "draft", name: "Draft" },
          { key: "active", name: "Active" },
        ],
      );
      check(
        "options=[{key: draft, name: Draft}, {key: active, name: Active}]",
        [
          { key: "draft", name: "Draft" },
          { key: "active", name: "Active" },
        ],
      );
    });

    it("sets array with comma-separated values for code format", () => {
      check(
        "tags=urgent,important,low-priority",
        ["urgent", "important", "low-priority"],
        coreFields.tags,
      );
      check("tags=urgent", ["urgent"], coreFields.tags);
    });

    it("sets array with newline-separated values for line format", () => {
      check(
        "aliases=first\nsecond\nthird",
        ["first", "second", "third"],
        mockAliasesField,
      );
    });

    it("sets array with blank-line-separated values for paragraph format", () => {
      check(
        "notes=para one\n\npara two",
        ["para one", "para two"],
        mockNotesField,
      );
    });

    it("appends single value", () => {
      check("tags+=urgent", ["insert", "urgent"], coreFields.tags);
    });

    it("appends multiple comma-separated values for identifier format", () => {
      check(
        "tags+=a,b,c",
        [
          ["insert", "a"],
          ["insert", "b"],
          ["insert", "c"],
        ],
        coreFields.tags,
      );
    });

    it("does not split on commas for paragraph format (+=)", () => {
      check(
        "notes+=This is a sentence, with a comma.",
        ["insert", "This is a sentence, with a comma."],
        mockNotesField,
      );
    });

    it("does not split on commas for line format (+=)", () => {
      check(
        "aliases+=Hello, world",
        ["insert", "Hello, world"],
        mockAliasesField,
      );
    });

    it("splits on newlines for line format (+=)", () => {
      check(
        "aliases+=first\nsecond\nthird",
        [
          ["insert", "first"],
          ["insert", "second"],
          ["insert", "third"],
        ],
        mockAliasesField,
      );
    });

    it("splits on blank lines for paragraph format (+=)", () => {
      check(
        "notes+=para one\n\npara two",
        [
          ["insert", "para one"],
          ["insert", "para two"],
        ],
        mockNotesField,
      );
    });

    it("does not split on commas for richtext block format (+=)", () => {
      check(
        "steps+=Step one, then step two",
        ["insert", "Step one, then step two"],
        mockStepsField,
      );
    });

    it("inserts at position with :accessor", () => {
      check("tags:0+=critical", ["insert", "critical", 0], coreFields.tags);
      check("tags:2+=important", ["insert", "important", 2], coreFields.tags);
      check("tags:first+=critical", ["insert", "critical", 0], coreFields.tags);
      check("tags:last+=urgent", ["insert", "urgent", "last"], coreFields.tags);
    });

    it("removes by value", () => {
      check("tags-=urgent", ["remove", "urgent"], coreFields.tags);
      check("tags:last-=urgent", ["remove", "urgent", "last"], coreFields.tags);
      check("tags:1-=urgent", ["remove", "urgent", 1], coreFields.tags);
    });

    it("removes multiple comma-separated values for identifier format", () => {
      check(
        "tags-=a,b,c",
        [
          ["remove", "a"],
          ["remove", "b"],
          ["remove", "c"],
        ],
        coreFields.tags,
      );
    });

    it("does not split on commas for paragraph format (-=)", () => {
      check(
        "notes-=A paragraph, with a comma.",
        ["remove", "A paragraph, with a comma."],
        mockNotesField,
      );
    });

    it("does not split on commas for line format (-=)", () => {
      check(
        "aliases-=Hello, world",
        ["remove", "Hello, world"],
        mockAliasesField,
      );
    });

    it("removes by position with :accessor", () => {
      check("tags:0--", ["remove", null, 0], coreFields.tags);
      check("tags:2--", ["remove", null, 2], coreFields.tags);
      check("tags:first--", ["remove", null, 0], coreFields.tags);
      check("tags:last--", ["remove", null, "last"], coreFields.tags);
    });

    it("handles quoted values", () => {
      check('title="has space"', "has space");
      check('title="a,b,c"', "a,b,c");
      check('tags+="has space"', ["insert", "has space"], coreFields.tags);
    });

    it("handles string values that look like primitives", () => {
      check("tags+=123", ["insert", "123"], coreFields.tags);
      check("tags+=true", ["insert", "true"], coreFields.tags);
    });

    it("handles ref values", () => {
      check("tags+=person/jan", ["insert", "person/jan"], coreFields.tags);
      check("tags:0+=note/beta", ["insert", "note/beta", 0], coreFields.tags);
      check(
        "tags:last-=note/stale",
        ["remove", "note/stale", "last"],
        coreFields.tags,
      );
    });
  });

  describe("patch operations", () => {
    it("patches attrs on field with :stringKey accessor", () => {
      check("fields:title={required: true}", [
        "patch",
        "title",
        { required: true },
      ]);
      check("fields:status={default: todo}", [
        "patch",
        "status",
        { default: "todo" },
      ]);
    });

    it("patches multiple attrs", () => {
      check("fields:title={required: true, default: Untitled}", [
        "patch",
        "title",
        { required: true, default: "Untitled" },
      ]);
    });

    it("patches with JSON syntax", () => {
      check('fields:title={"required":true}', [
        "patch",
        "title",
        { required: true },
      ]);
    });

    it("removes attr with null", () => {
      check("fields:title={required: null}", [
        "patch",
        "title",
        { required: null },
      ]);
    });
  });

  describe("parsePatches with schema", () => {
    it("parses multiple patches", () => {
      checkWithSchema(["title=test", "status=active", "favorite=true"], {
        title: "test",
        status: "active",
        favorite: true,
      });
    });

    it("parses empty array of patches", () => {
      checkWithSchema([], {});
    });

    it("handles array operations in patches", () => {
      checkWithSchema(["tags+=urgent,important"], {
        tags: [
          ["insert", "urgent"],
          ["insert", "important"],
        ],
      });
    });

    it("parses core fields like key", () => {
      checkWithSchema(["key=my-key", "title=test"], {
        key: "my-key",
        title: "test",
      });
    });

    it("merges multiple += patches for same field", () => {
      checkWithSchema(["tags+=one", "tags+=two"], {
        tags: [
          ["insert", "one"],
          ["insert", "two"],
        ],
      });
    });

    it("merges multiple += patches with comma values for same field", () => {
      checkWithSchema(["tags+=a,b", "tags+=c"], {
        tags: [
          ["insert", "a"],
          ["insert", "b"],
          ["insert", "c"],
        ],
      });
    });

    it("merges += and -= patches for same field", () => {
      checkWithSchema(["tags+=new", "tags-=old"], {
        tags: [
          ["insert", "new"],
          ["remove", "old"],
        ],
      });
    });

    it("errors when multiple = patches for same field", () => {
      const result = parsePatches(
        ["title=first", "title=second"],
        mockRecordSchema,
      );
      expect(result).toBeErrWithKey("duplicate-field-patch");
    });

    it("errors when mixing = and += for same field", () => {
      const result = parsePatches(
        ["tags=first", "tags+=second"],
        mockRecordSchema,
      );
      expect(result).toBeErrWithKey("duplicate-field-patch");
    });

    it("errors when mixing += and = for same field", () => {
      const result = parsePatches(
        ["tags+=first", "tags=second"],
        mockRecordSchema,
      );
      expect(result).toBeErrWithKey("duplicate-field-patch");
    });
  });

  describe("error handling", () => {
    it("returns error for invalid patch format", () => {
      expect(parseFieldChange("invalid", coreFields.title)).toBeErrWithKey(
        "invalid-patch-format",
      );
    });

    it("returns error for remove by position without accessor", () => {
      expect(parseFieldChange("tags--", coreFields.tags)).toBeErrWithKey(
        "missing-accessor",
      );
    });

    it("returns error for invalid YAML/JSON", () => {
      expect(
        parseFieldChange("field={invalid: json: here}", coreFields.title),
      ).toBeErrWithKey("invalid-yaml-format");
    });

    it("provides helpful hint for shell quoting issues", () => {
      const result = parsePatches([`Solutions"`], mockRecordSchema);
      expect(result).toBeErrWithKey("invalid-patch-format");
      if (isErr(result)) {
        expect(result.error.message).toContain("quote the entire patch");
      }
    });

    it("returns error for unknown field", () => {
      const result = parsePatches(["unknown=value"], mockRecordSchema);
      expect(result).toBeErrWithKey("field-not-found");
    });
  });

  it("handles patches with surrounding single quotes", () => {
    check(`'title=value'`, "value");
    check(`'field=123'`, 123, coreFields.id);
    check(`'favorite=true'`, true, mockFavoriteField);
    check(`'tags=a,b,c'`, ["a", "b", "c"], coreFields.tags);
    check(`'options=[{"key":"draft","name":"Draft"}]'`, [
      { key: "draft", name: "Draft" },
    ]);
  });

  it("handles value with surrounding quotes when patch has quotes", () => {
    check(`'title="value"'`, "value");
    check(`"title='value'"`, "value");
  });
});

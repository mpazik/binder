import { expect, it, describe } from "bun:test";
import "@binder/utils/tests";
import { coreFields, type FieldChangeInput, type FieldDef } from "@binder/db";
import {
  mockAliasesField,
  mockFavoriteField,
  mockNodeSchemaFull,
  mockNotesField,
  mockPriceField,
  mockTagsField,
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
    const result = parsePatches(patches, mockNodeSchemaFull);
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

    it("sets array with comma-separated values for code alphabet", () => {
      check(
        "tags=urgent,important,low-priority",
        ["urgent", "important", "low-priority"],
        mockTagsField,
      );
      check("tags=urgent", ["urgent"], mockTagsField);
    });

    it("sets array with newline-separated values for line alphabet", () => {
      check(
        "aliases=first\nsecond\nthird",
        ["first", "second", "third"],
        mockAliasesField,
      );
    });

    it("sets array with blank-line-separated values for paragraph alphabet", () => {
      check(
        "notes=para one\n\npara two",
        ["para one", "para two"],
        mockNotesField,
      );
    });

    it("appends single value", () => {
      check("tags+=urgent", ["insert", "urgent"], mockTagsField);
    });

    it("appends multiple values", () => {
      check(
        "tags+=a,b,c",
        [
          ["insert", "a"],
          ["insert", "b"],
          ["insert", "c"],
        ],
        mockTagsField,
      );
    });

    it("inserts at position with :accessor", () => {
      check("tags:0+=critical", ["insert", "critical", 0], mockTagsField);
      check("tags:2+=important", ["insert", "important", 2], mockTagsField);
      check("tags:first+=critical", ["insert", "critical", 0], mockTagsField);
      check("tags:last+=urgent", ["insert", "urgent", "last"], mockTagsField);
    });

    it("removes by value", () => {
      check("tags-=urgent", ["remove", "urgent"], mockTagsField);
      check("tags:last-=urgent", ["remove", "urgent", "last"], mockTagsField);
      check("tags:1-=urgent", ["remove", "urgent", 1], mockTagsField);
    });

    it("removes by position with :accessor", () => {
      check("tags:0--", ["remove", null, 0], mockTagsField);
      check("tags:2--", ["remove", null, 2], mockTagsField);
      check("tags:first--", ["remove", null, 0], mockTagsField);
      check("tags:last--", ["remove", null, "last"], mockTagsField);
    });

    it("handles quoted values", () => {
      check('title="has space"', "has space");
      check('title="a,b,c"', "a,b,c");
      check('tags+="has space"', ["insert", "has space"], mockTagsField);
    });

    it("handles string values that look like primitives", () => {
      check("tags+=123", ["insert", "123"], mockTagsField);
      check("tags+=true", ["insert", "true"], mockTagsField);
    });

    it("handles ref values", () => {
      check("tags+=person/jan", ["insert", "person/jan"], mockTagsField);
      check("tags:0+=note/beta", ["insert", "note/beta", 0], mockTagsField);
      check(
        "tags:last-=note/stale",
        ["remove", "note/stale", "last"],
        mockTagsField,
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
  });

  describe("error handling", () => {
    it("returns error for invalid patch format", () => {
      expect(parseFieldChange("invalid", coreFields.title)).toBeErrWithKey(
        "invalid-patch-format",
      );
    });

    it("returns error for remove by position without accessor", () => {
      expect(parseFieldChange("tags--", mockTagsField)).toBeErrWithKey(
        "missing-accessor",
      );
    });

    it("returns error for invalid YAML/JSON", () => {
      expect(
        parseFieldChange("field={invalid: json: here}", coreFields.title),
      ).toBeErrWithKey("invalid-yaml-format");
    });

    it("provides helpful hint for shell quoting issues", () => {
      const result = parsePatches([`Solutions"`], mockNodeSchemaFull);
      expect(result).toBeErrWithKey("invalid-patch-format");
      if (isErr(result)) {
        expect(result.error.message).toContain("quote the entire patch");
      }
    });

    it("returns error for unknown field", () => {
      const result = parsePatches(["unknown=value"], mockNodeSchemaFull);
      expect(result).toBeErrWithKey("field-not-found");
    });
  });

  it("handles patches with surrounding single quotes", () => {
    check(`'title=value'`, "value");
    check(`'field=123'`, 123, coreFields.id);
    check(`'favorite=true'`, true, mockFavoriteField);
    check(`'tags=a,b,c'`, ["a", "b", "c"], mockTagsField);
    check(`'options=[{"key":"draft","name":"Draft"}]'`, [
      { key: "draft", name: "Draft" },
    ]);
  });

  it("handles value with surrounding quotes when patch has quotes", () => {
    check(`'title="value"'`, "value");
    check(`"title='value'"`, "value");
  });
});

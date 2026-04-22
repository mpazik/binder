import { expect, it, describe } from "bun:test";
import "@binder/utils/tests";
import {
  predefinedFields,
  type FieldChangeInput,
  type FieldDef,
} from "@binder/repo";
import {
  mockAliasesField,
  mockFavoriteField,
  mockRecordSchema,
  mockNotesField,
  mockPriceField,
  mockStepsField,
} from "@binder/repo/mocks";
import { isErr } from "@binder/utils";
import {
  parseFieldChange,
  parsePatches,
  parseCreatePatches,
} from "./patch-parser.ts";

describe("patch-parser", () => {
  const check = (
    patch: string,
    expected: FieldChangeInput,
    fieldDef: FieldDef = predefinedFields.title,
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
    check("field=42", 42, predefinedFields.id);
    check("field=-10", -10, predefinedFields.id);
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
        predefinedFields.tags,
      );
      check("tags=urgent", ["urgent"], predefinedFields.tags);
    });

    it("sets array with comma-separated values for filepath format", () => {
      check(
        "sourceFiles=src/a.ts,src/b.ts,src/c.ts",
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        predefinedFields.sourceFiles,
      );
      check("sourceFiles=src/a.ts", ["src/a.ts"], predefinedFields.sourceFiles);
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
      check("tags+=urgent", ["insert", "urgent"], predefinedFields.tags);
    });

    it("appends multiple comma-separated values for identifier format", () => {
      check(
        "tags+=a,b,c",
        [
          ["insert", "a"],
          ["insert", "b"],
          ["insert", "c"],
        ],
        predefinedFields.tags,
      );
    });

    it("appends multiple comma-separated values for filepath format", () => {
      check(
        "sourceFiles+=src/a.ts,src/b.ts",
        [
          ["insert", "src/a.ts"],
          ["insert", "src/b.ts"],
        ],
        predefinedFields.sourceFiles,
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
      check(
        "tags:0+=critical",
        ["insert", "critical", 0],
        predefinedFields.tags,
      );
      check(
        "tags:2+=important",
        ["insert", "important", 2],
        predefinedFields.tags,
      );
      check(
        "tags:first+=critical",
        ["insert", "critical", 0],
        predefinedFields.tags,
      );
      check(
        "tags:last+=urgent",
        ["insert", "urgent", "last"],
        predefinedFields.tags,
      );
    });

    it("removes by value", () => {
      check("tags-=urgent", ["remove", "urgent"], predefinedFields.tags);
      check(
        "tags:last-=urgent",
        ["remove", "urgent", "last"],
        predefinedFields.tags,
      );
      check("tags:1-=urgent", ["remove", "urgent", 1], predefinedFields.tags);
    });

    it("removes multiple comma-separated values for identifier format", () => {
      check(
        "tags-=a,b,c",
        [
          ["remove", "a"],
          ["remove", "b"],
          ["remove", "c"],
        ],
        predefinedFields.tags,
      );
    });

    it("removes multiple comma-separated values for filepath format", () => {
      check(
        "sourceFiles-=src/a.ts,src/b.ts",
        [
          ["remove", "src/a.ts"],
          ["remove", "src/b.ts"],
        ],
        predefinedFields.sourceFiles,
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
      check("tags:0--", ["remove", null, 0], predefinedFields.tags);
      check("tags:2--", ["remove", null, 2], predefinedFields.tags);
      check("tags:first--", ["remove", null, 0], predefinedFields.tags);
      check("tags:last--", ["remove", null, "last"], predefinedFields.tags);
    });

    it("handles quoted values", () => {
      check('title="has space"', "has space");
      check('title="a,b,c"', "a,b,c");
      check(
        'tags+="has space"',
        ["insert", "has space"],
        predefinedFields.tags,
      );
    });

    it("does not split quoted filepath values on commas", () => {
      check(
        'sourceFiles+="path/with,comma.ts"',
        ["insert", "path/with,comma.ts"],
        predefinedFields.sourceFiles,
      );
    });

    it("handles string values that look like primitives", () => {
      check("tags+=123", ["insert", "123"], predefinedFields.tags);
      check("tags+=true", ["insert", "true"], predefinedFields.tags);
    });

    it("handles ref values", () => {
      check(
        "tags+=person/jan",
        ["insert", "person/jan"],
        predefinedFields.tags,
      );
      check(
        "tags:0+=note/beta",
        ["insert", "note/beta", 0],
        predefinedFields.tags,
      );
      check(
        "tags:last-=note/stale",
        ["remove", "note/stale", "last"],
        predefinedFields.tags,
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
      expect(
        parseFieldChange("invalid", predefinedFields.title),
      ).toBeErrWithKey("invalid-patch-format");
    });

    it("returns error for remove by position without accessor", () => {
      expect(parseFieldChange("tags--", predefinedFields.tags)).toBeErrWithKey(
        "missing-accessor",
      );
    });

    it("returns error for invalid YAML/JSON", () => {
      expect(
        parseFieldChange("field={invalid: json: here}", predefinedFields.title),
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

  describe("quote handling", () => {
    it("strips surrounding single quotes from patch", () => {
      check(`'title=value'`, "value");
      check(`'field=123'`, 123, predefinedFields.id);
      check(`'favorite=true'`, true, mockFavoriteField);
      check(`'tags=a,b,c'`, ["a", "b", "c"], predefinedFields.tags);
      check(`'options=[{"key":"draft","name":"Draft"}]'`, [
        { key: "draft", name: "Draft" },
      ]);
    });

    it("strips nested surrounding quotes from value", () => {
      check(`'title="value"'`, "value");
      check(`"title='value'"`, "value");
    });
  });

  describe("parseCreatePatches", () => {
    const check = (patches: string[], type: string, fieldPatches: string[]) =>
      expect(parseCreatePatches(patches)).toBeOkWith({ type, fieldPatches });

    const checkErr = (patches: string[], key: string) =>
      expect(parseCreatePatches(patches)).toBeErrWithKey(key);

    describe("type", () => {
      it("takes first non-patch as type", () => {
        check(["Task"], "Task", []);
      });

      it("extracts type from type=X patch when no positional type", () => {
        check(["type=Task", "key=my-key", "title=Hello"], "Task", [
          "key=my-key",
          "title=Hello",
        ]);
      });

      it("errors when type is missing", () => {
        checkErr([], "missing-type");
      });

      it("errors when first item is a patch and no type=X patch provided", () => {
        checkErr(["title=Hello"], "missing-type");
      });

      it("errors on duplicate type", () => {
        checkErr(["Task", "type=Task"], "duplicate-type");
      });
    });

    describe("key", () => {
      it("takes second non-patch as key and appends it as key=X patch", () => {
        check(["Task", "my-key", "title=Hello"], "Task", [
          "title=Hello",
          "key=my-key",
        ]);
      });

      it("accepts key as patch", () => {
        check(["Task", "title=Hello", "key=my-key"], "Task", [
          "title=Hello",
          "key=my-key",
        ]);
      });

      it("errors on duplicate key", () => {
        checkErr(["Task", "my-key", "key=my-key"], "duplicate-key");
      });
    });

    describe("extra positionals", () => {
      it("errors on third non-patch item", () => {
        checkErr(["Task", "my-key", "extra"], "extra-positionals");
      });

      it("errors on non-patch item after a patch", () => {
        checkErr(["title=Hello", "Task"], "extra-positionals");
      });
    });
  });
});

import { expect, it, describe } from "bun:test";
import "@binder/utils/tests";
import type { FieldChangeInput } from "@binder/db";
import { isErr } from "@binder/utils";
import { parseFieldChange, parsePatches } from "./patch-parser.ts";

describe("patch-parser", () => {
  const check = (patch: string, expected: FieldChangeInput) => {
    const result = parseFieldChange(patch);
    expect(result).toBeOkWith(expected);
  };

  const checkArray = (
    patches: string[],
    expected: Record<string, FieldChangeInput>,
  ) => {
    const result = parsePatches(patches);
    expect(result).toBeOkWith(expected);
  };

  it("parses boolean", () => {
    check("field=true", true);
    check("field=false", false);
  });

  it("parses integer", () => {
    check("field=42", 42);
    check("field=-10", -10);
  });

  it("parses float", () => {
    check("field=3.14", 3.14);
    check("field=-2.5", -2.5);
  });

  it("parses string", () => {
    check("field=hello", "hello");
    check("field=hello world", "hello world");
    check("field=null", "null");
  });

  it("parses empty string", () => {
    check("field=", "");
    check('field=""', "");
  });

  it("parses file path values", () => {
    check("body=docs/intro.md", "docs/intro.md");
    check("author=person/jan", "person/jan");
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

    it("sets array with comma-separated values", () => {
      check("tags=a,b,c", ["a", "b", "c"]);
      check("tags=urgent", "urgent");
    });

    it("appends single value", () => {
      check("tags+=urgent", ["insert", "urgent"]);
    });

    it("appends multiple values", () => {
      check("tags+=a,b,c", [
        ["insert", "a"],
        ["insert", "b"],
        ["insert", "c"],
      ]);
    });

    it("inserts at position with :accessor", () => {
      check("tags:0+=critical", ["insert", "critical", 0]);
      check("tags:2+=important", ["insert", "important", 2]);
      check("tags:first+=critical", ["insert", "critical", 0]);
      check("tags:last+=urgent", ["insert", "urgent", "last"]);
    });

    it("removes by value", () => {
      check("tags-=urgent", ["remove", "urgent"]);
      check("tags:last-=urgent", ["remove", "urgent", "last"]);
      check("tags:1-=urgent", ["remove", "urgent", 1]);
    });

    it("removes by position with :accessor", () => {
      check("tags:0--", ["remove", null, 0]);
      check("tags:2--", ["remove", null, 2]);
      check("tags:first--", ["remove", null, 0]);
      check("tags:last--", ["remove", null, "last"]);
    });

    it("handles quoted values", () => {
      check('tags="has space"', "has space");
      check('tags="a,b,c"', "a,b,c");
      check('tags+="has space"', ["insert", "has space"]);
    });

    it("handles string values that look like primitives", () => {
      check("tags+=123", ["insert", "123"]);
      check("tags+=true", ["insert", "true"]);
    });

    it("handles ref values", () => {
      check("links+=person/jan", ["insert", "person/jan"]);
      check("links:0+=note/beta", ["insert", "note/beta", 0]);
      check("links:last-=note/stale", ["remove", "note/stale", "last"]);
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

  it("parses multiple patches", () => {
    checkArray(["name=test", "count=5", "active=true"], {
      name: "test",
      count: 5,
      active: true,
    });
  });

  it("parses empty array of patches", () => {
    checkArray([], {});
  });

  it("handles mixed value types in patches", () => {
    checkArray(
      [
        "str=hello",
        "num=42",
        "bool=true",
        'arr=["a","b"]',
        'obj={"key":"val"}',
      ],
      {
        str: "hello",
        num: 42,
        bool: true,
        arr: ["a", "b"],
        obj: { key: "val" },
      },
    );
  });

  it("handles array operations in patches", () => {
    checkArray(["tags+=a,b,c", "items:0--", "list=x,y,z"], {
      tags: [
        ["insert", "a"],
        ["insert", "b"],
        ["insert", "c"],
      ],
      items: ["remove", null, 0],
      list: ["x", "y", "z"],
    });
  });

  it("handles patch operations in patches", () => {
    checkArray(
      ["fields:title={required: true}", "fields:status={default: todo}"],
      {
        fields: ["patch", "status", { default: "todo" }],
      },
    );
  });

  describe("error handling", () => {
    it("returns error for invalid patch format", () => {
      expect(parseFieldChange("invalid")).toBeErrWithKey(
        "invalid-patch-format",
      );
    });

    it("returns error for remove by position without accessor", () => {
      expect(parseFieldChange("tags--")).toBeErrWithKey("missing-accessor");
    });

    it("returns error for invalid YAML/JSON", () => {
      expect(parseFieldChange("field={invalid: json: here}")).toBeErrWithKey(
        "invalid-yaml-format",
      );
    });

    it("provides helpful hint for shell quoting issues", () => {
      const result = parsePatches([`Solutions"`]);
      expect(result).toBeErrWithKey("invalid-patch-format");
      if (isErr(result)) {
        expect(result.error.message).toContain("quote the entire patch");
      }
    });
  });

  it("handles patches with surrounding single quotes", () => {
    check(`'field=value'`, "value");
    check(`'field=123'`, 123);
    check(`'field=true'`, true);
    check(`'tags=a,b,c'`, ["a", "b", "c"]);
    check(`'options=[{"key":"draft","name":"Draft"}]'`, [
      { key: "draft", name: "Draft" },
    ]);
  });

  it("handles value with surrounding quotes when patch has quotes", () => {
    check(`'field="value"'`, "value");
    check(`"field='value'"`, "value");
  });
});

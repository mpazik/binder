import { expect, it, describe } from "bun:test";
import "@binder/utils/tests";
import type { FieldChangeInput } from "@binder/db";
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
    it("sets array with JSON", () => {
      check('field=["a","b","c"]', ["a", "b", "c"]);
      check("field=[]", []);
      check("field=[1,2,3]", [1, 2, 3]);
      check("field=[true,false,null]", [true, false, null]);
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

    it("inserts at position", () => {
      check("tags[0]+=critical", ["insert", "critical", 0]);
      check("tags[2]+=important", ["insert", "important", 2]);
      check("tags[last]+=urgent", ["insert", "urgent", "last"]);
      check("tags[-1]+=urgent", ["insert", "urgent", "last"]);
    });

    it("removes by value", () => {
      check("tags[last]-=urgent", ["remove", "urgent", "last"]);
      check("tags[-1]-=urgent", ["remove", "urgent", "last"]);
      check("tags[all]-=todo", ["remove", "todo", "all"]);
      check("tags[1]-=urgent", ["remove", "urgent", 1]);
    });

    it("removes multiple values", () => {
      check("tags[all]-=a,b,c", [
        ["remove", "a", "all"],
        ["remove", "b", "all"],
        ["remove", "c", "all"],
      ]);
    });

    it("removes by position", () => {
      check("tags[0]--", ["remove", null, 0]);
      check("tags[2]--", ["remove", null, 2]);
      check("tags[last]--", ["remove", null, "last"]);
      check("tags[-1]--", ["remove", null, "last"]);
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
      check("links[0]+=note/beta", ["insert", "note/beta", 0]);
      check("links[-1]-=note/stale", ["remove", "note/stale", "last"]);
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
    checkArray(
      ["tags+=a,b,c", "old[all]-=legacy", "items[0]--", "list=x,y,z"],
      {
        tags: [
          ["insert", "a"],
          ["insert", "b"],
          ["insert", "c"],
        ],
        old: ["remove", "legacy", "all"],
        items: ["remove", null, 0],
        list: ["x", "y", "z"],
      },
    );
  });

  it("returns error for invalid patch format", () => {
    expect(parseFieldChange("invalid")).toBeErrWithKey("invalid-patch-format");
  });

  it("returns error for invalid array index", () => {
    expect(parseFieldChange("tags[abc]+=urgent")).toBeErrWithKey(
      "invalid-array-index",
    );
  });

  it("returns error for remove by position without index", () => {
    expect(parseFieldChange("tags--")).toBeErrWithKey("missing-index");
  });

  it("returns error for invalid JSON", () => {
    expect(parseFieldChange("field={invalid json}")).toBeErrWithKey(
      "invalid-json-format",
    );
  });
});

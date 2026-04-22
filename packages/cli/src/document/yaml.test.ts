import { describe, expect, it } from "bun:test";
import type { Result } from "@binder/utils";
import { mockRecordSchema } from "@binder/repo/mocks";
import {
  renderYamlEntity,
  renderYamlList,
  parseYamlEntity,
  parseYamlList,
  findEntityInYamlList,
} from "./yaml.ts";

describe("yaml", () => {
  describe("inline formatting", () => {
    it("renders short comma-delimited arrays inline", () => {
      const yaml = renderYamlEntity(
        { title: "Task", tags: ["bug", "urgent"] },
        mockRecordSchema,
      );
      expect(yaml).toContain("tags: [ bug, urgent ]");
    });

    it("renders single-element array inline", () => {
      const yaml = renderYamlEntity({ tags: ["only"] }, mockRecordSchema);
      expect(yaml).toContain("tags: [ only ]");
    });
  });

  describe("block formatting", () => {
    const check = (
      entity: Parameters<typeof renderYamlEntity>[0],
      expectedSnippet: string,
      opts?: { expectNoInlineArray?: boolean },
    ) => {
      const yaml = renderYamlEntity(entity, mockRecordSchema);
      if (opts?.expectNoInlineArray) expect(yaml).not.toContain("[");
      expect(yaml).toContain(expectedSnippet);
    };

    it("renders multi-value relation as block list", () => {
      check(
        { title: "Task", relatedTo: ["task-a", "task-b"] },
        "relatedTo:\n  - task-a\n  - task-b",
        { expectNoInlineArray: true },
      );
    });

    it("renders single-element relation as block list", () => {
      check({ relatedTo: ["a"] }, "relatedTo:\n  - a", {
        expectNoInlineArray: true,
      });
    });

    it("keeps nested object and enum formatting inline inside forced block lists", () => {
      const schema = {
        fields: {
          fields: { dataType: "relation", allowMultiple: true },
          only: {
            dataType: "plaintext",
            allowMultiple: true,
            plaintextFormat: "identifier",
          },
          required: { dataType: "boolean" },
        },
        types: {},
      };

      const yaml = renderYamlEntity(
        {
          fields: [
            { key: { required: true } },
            { status: { only: ["draft", "active"] } },
          ],
        },
        schema as any,
      );

      expect(yaml).toContain("fields:\n  - key: { required: true }");
      expect(yaml).toContain("- status: { only: [ draft, active ] }");
    });

    it("renders newline-delimited field as block list", () => {
      check({ aliases: ["Alpha", "Beta"] }, "aliases:\n  - Alpha\n  - Beta");
    });

    it("renders blankline-delimited field as block list", () => {
      check(
        { notes: ["First note", "Second note"] },
        "notes:\n  - First note\n  - Second note",
      );
    });
  });

  describe("scalar fields", () => {
    it("renders string values", () => {
      const yaml = renderYamlEntity({ title: "My Task" });
      expect(yaml).toContain("title: My Task");
    });

    it("renders single relation value as scalar", () => {
      const yaml = renderYamlEntity(
        { title: "Task", project: "proj-1" },
        mockRecordSchema,
      );
      expect(yaml).toContain("project: proj-1");
    });
  });

  describe("without schema", () => {
    it("renders arrays inline", () => {
      const yaml = renderYamlEntity({ relatedTo: ["a", "b"] });
      expect(yaml).toContain("[ a, b ]");
    });
  });

  describe("list rendering", () => {
    it("wraps items in an items key", () => {
      const yaml = renderYamlList([{ title: "Task 1" }]);
      expect(yaml).toContain("items:");
      expect(yaml).toContain("title: Task 1");
    });

    it("adds blank line between list items", () => {
      const yaml = renderYamlList([{ title: "Task 1" }, { title: "Task 2" }]);
      const lines = yaml.split("\n");
      const secondItemIndex = lines.findIndex((l) => l.includes("Task 2"));
      const dashIndex = lines.findLastIndex(
        (l, i) => i < secondItemIndex && l.trim().startsWith("-"),
      );
      expect(dashIndex).toBeGreaterThan(0);
    });

    it("renders empty list", () => {
      const yaml = renderYamlList([]);
      expect(yaml).toContain("items: []");
    });

    it("renders relation fields as block list in list items", () => {
      const yaml = renderYamlList(
        [
          { title: "Task 1", relatedTo: ["task-a", "task-b"] },
          { title: "Task 2", relatedTo: ["task-c"] },
        ],
        mockRecordSchema,
      );
      expect(yaml).not.toContain("[");
      expect(yaml).toContain("relatedTo:\n      - task-a\n      - task-b");
      expect(yaml).toContain("relatedTo:\n      - task-c");
    });
  });

  describe("round-trip stability", () => {
    it("round-trips entity with relation fields", () => {
      const entity = {
        title: "Task",
        project: "proj-1",
        relatedTo: ["task-a", "task-b"],
        tags: ["bug", "urgent"],
      };
      const rendered = renderYamlEntity(entity, mockRecordSchema);
      const parsed = parseYamlEntity(rendered);
      expect(parsed.data).toEqual(entity);
      expect(renderYamlEntity(parsed.data!, mockRecordSchema)).toEqual(
        rendered,
      );
    });

    it("round-trips list with relation fields", () => {
      const items = [
        { title: "Task 1", relatedTo: ["task-a"] },
        { title: "Task 2", relatedTo: ["task-b", "task-c"] },
      ];
      const rendered = renderYamlList(items, mockRecordSchema);
      const parsed = parseYamlList(rendered);
      expect(parsed.data).toEqual(items);
    });
  });

  const checkParseError = (
    input: string,
    parser: (yaml: string) => { error?: unknown },
  ) => {
    const result = parser(input);
    expect(result.error).toBeDefined();
  };

  describe("parseYamlEntity", () => {
    it("parses valid YAML", () => {
      const result = parseYamlEntity("title: Hello\nstatus: active\n");
      expect(result.data).toEqual({ title: "Hello", status: "active" });
    });

    it("returns error for invalid YAML", () => {
      checkParseError("key: [unclosed", parseYamlEntity);
    });
  });

  describe("parseYamlList", () => {
    it("parses items from YAML list", () => {
      const result = parseYamlList(
        "items:\n  - title: Task 1\n  - title: Task 2\n",
      );
      expect(result.data).toEqual([{ title: "Task 1" }, { title: "Task 2" }]);
    });

    it("returns error for invalid YAML", () => {
      checkParseError("items: [unclosed", parseYamlList);
    });
  });

  describe("humanized YAML errors", () => {
    const check = (
      input: string,
      messagePattern: RegExp,
      opts?: { parser?: (content: string) => Result<unknown> },
    ) => {
      const parse = opts?.parser ?? parseYamlEntity;
      const result = parse(input);
      expect(result.error).toBeDefined();
      expect(result.error!.key).toBe("yaml_parse_error");
      expect(result.error!.message).toMatch(messagePattern);
    };

    it("rewrites implicit map key error", () => {
      check(
        "title: foo\ndescription: bar\np\n",
        /Could not parse YAML \(line 3\):.*`key: value`/,
      );
    });

    it("rewrites multiline implicit key error", () => {
      check(
        "title: foo\nhello world\nstatus: bar\n",
        /Could not parse YAML \(line 2\):.*multiple lines/,
      );
    });

    it("rewrites block-as-implicit-key error", () => {
      check(
        "title: foo\n  status: done\n",
        /Could not parse YAML.*Unexpected nested value/,
      );
    });

    it("preserves clear messages like duplicate key", () => {
      check(
        "title: foo\ntitle: bar\n",
        /Could not parse YAML \(line 2\):.*Map keys must be unique/,
      );
    });

    it("preserves tab indentation message", () => {
      check(
        "title: foo\n\tstatus: done\n",
        /Could not parse YAML \(line 2\):.*Tabs are not allowed/,
      );
    });

    it("does not rewrite non-implicit MISSING_CHAR errors", () => {
      check('title: "foo\n', /Could not parse YAML.*Missing closing/);
      const result = parseYamlEntity('title: "foo\n');
      expect(result.error!.message).not.toContain("`key: value`");
    });

    it("humanizes errors from parseYamlList", () => {
      check(
        "items:\n  - title: foo\np\n",
        /Could not parse YAML.*`key: value`/,
        {
          parser: parseYamlList,
        },
      );
    });
  });

  describe("findEntityInYamlList", () => {
    const yaml = `- key: task-1
  title: First
- key: task-2
  title: Second
- uid: abc-123
  title: Third`;

    const check = (
      key: string | undefined,
      uid: string | undefined,
      expected: number,
    ) => {
      expect(findEntityInYamlList(yaml, key, uid)).toBe(expected);
    };

    it("finds entity by key", () => check("task-2", undefined, 2));
    it("finds entity by uid", () => check(undefined, "abc-123", 4));
    it("returns 0 for first entity", () => check("task-1", undefined, 0));
    it("returns 0 when entity not found", () => check("missing", undefined, 0));
    it("returns 0 when both key and uid are undefined", () =>
      check(undefined, undefined, 0));
  });
});

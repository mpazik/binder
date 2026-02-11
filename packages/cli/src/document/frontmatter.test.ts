import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import {
  extractFrontmatterFromAst,
  prependFrontmatter,
  renderFrontmatterString,
} from "./frontmatter.ts";
import { parseMarkdown } from "./markdown.ts";

describe("frontmatter", () => {
  describe("renderFrontmatterString", () => {
    const check = (
      entity: FieldsetNested,
      preambleKeys: string[],
      expected: string | undefined,
    ) => {
      const result = renderFrontmatterString(entity, preambleKeys);
      expect(result).toBe(expected);
    };

    it("renders simple string fields", () => {
      check(
        { name: "Task Card", status: "active" },
        ["name"],
        "name: Task Card",
      );
    });

    it("renders multiple fields", () => {
      check(
        { name: "Task Card", templateFormat: "block" },
        ["name", "templateFormat"],
        "name: Task Card\ntemplateFormat: block",
      );
    });

    it("renders array fields", () => {
      check(
        { preamble: ["status", "dueDate"] },
        ["preamble"],
        "preamble: [ status, dueDate ]",
      );
    });

    it("skips null values", () => {
      check(
        { name: "Task Card", description: null },
        ["name", "description"],
        "name: Task Card",
      );
    });

    it("skips undefined values", () => {
      check({ name: "Task Card" }, ["name", "missing"], "name: Task Card");
    });

    it("returns undefined when all values are null", () => {
      check(
        { name: null, description: null },
        ["name", "description"],
        undefined,
      );
    });

    it("returns undefined for empty preamble keys", () => {
      check({ name: "Task Card" }, [], undefined);
    });
  });

  describe("prependFrontmatter", () => {
    it("prepends front matter to markdown", () => {
      const result = prependFrontmatter(
        "# Title\n\nContent\n",
        "name: Task Card",
      );
      expect(result).toBe("---\nname: Task Card\n---\n\n# Title\n\nContent\n");
    });
  });

  describe("extractFrontmatterFromAst", () => {
    const check = (
      markdown: string,
      expectedFields: FieldsetNested,
      expectedBodyContainsYaml: boolean,
    ) => {
      const ast = parseMarkdown(markdown);
      const result = throwIfError(extractFrontmatterFromAst(ast));
      expect(result.frontmatterFields).toEqual(expectedFields);
      const hasYamlNode = result.bodyAst.children.some(
        (child) => child.type === "yaml",
      );
      expect(hasYamlNode).toBe(expectedBodyContainsYaml);
    };

    it("extracts front matter fields", () => {
      check(
        "---\nname: Task Card\ntemplateFormat: block\n---\n\n# Title\n",
        { name: "Task Card", templateFormat: "block" },
        false,
      );
    });

    it("extracts array front matter fields", () => {
      check(
        "---\npreamble:\n  - status\n  - dueDate\n---\n\n# Title\n",
        { preamble: ["status", "dueDate"] },
        false,
      );
    });

    it("returns empty fields when no front matter", () => {
      check("# Title\n\nContent\n", {}, false);
    });

    it("preserves body AST without front matter node", () => {
      const markdown = "---\nname: Test\n---\n\n# Title\n\nBody text\n";
      const ast = parseMarkdown(markdown);
      const result = throwIfError(extractFrontmatterFromAst(ast));
      const bodyTypes = result.bodyAst.children.map((c) => c.type);
      expect(bodyTypes).toEqual(["heading", "paragraph"]);
    });
  });

  describe("round-trip", () => {
    it("renders and extracts front matter fields", () => {
      const entity = {
        name: "Task Card",
        templateFormat: "block",
        preamble: ["status", "dueDate"],
      };
      const preambleKeys = ["name", "templateFormat", "preamble"];
      const frontmatter = renderFrontmatterString(entity, preambleKeys)!;
      const markdown = prependFrontmatter("# {title}\n", frontmatter);

      const ast = parseMarkdown(markdown);
      const result = throwIfError(extractFrontmatterFromAst(ast));
      expect(result.frontmatterFields).toEqual(entity);
    });
  });
});

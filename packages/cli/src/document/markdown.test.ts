import { describe, expect, it } from "bun:test";
import {
  parseMarkdown,
  renderAstToMarkdown,
  simplifyAst,
  parseAst,
  removePosition,
} from "./markdown.ts";

describe("markdown", () => {
  describe("parseMarkdown", () => {
    it("parses heading", () => {
      const ast = parseMarkdown("# Hello");
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "Hello" }],
          },
        ],
      });
    });

    it("parses paragraph", () => {
      const ast = parseMarkdown("Hello world");
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Hello world" }],
          },
        ],
      });
    });

    it("flattens inline formatting into text", () => {
      const ast = parseMarkdown("Hello **bold** and _italic_");
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Hello **bold** and _italic_" }],
          },
        ],
      });
    });

    it("parses list with inline formatting flattened", () => {
      const ast = parseMarkdown("- **Item 1**\n- _Item 2_");
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", value: "**Item 1**" }],
                  },
                ],
              },
              {
                type: "listItem",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", value: "_Item 2_" }],
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it("preserves multi-line text in paragraph", () => {
      const ast = parseMarkdown("Line one\nLine two");
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Line one\nLine two" }],
          },
        ],
      });
    });
  });

  describe("renderAstToMarkdown", () => {
    it("renders heading", () => {
      const ast = parseAst("# Hello");
      expect(renderAstToMarkdown(ast)).toBe("# Hello\n");
    });

    it("renders list with dash bullet", () => {
      const ast = parseAst("- Item 1\n- Item 2");
      expect(renderAstToMarkdown(ast)).toBe("- Item 1\n- Item 2\n");
    });

    it("renders thematic break with dashes", () => {
      const ast = parseAst("---");
      expect(renderAstToMarkdown(ast)).toBe("---\n");
    });

    it("renders emphasis with underscore", () => {
      const ast = parseAst("*italic*");
      expect(renderAstToMarkdown(ast)).toBe("_italic_\n");
    });

    it("renders paragraph followed by list without blank line", () => {
      const ast = parseAst("Focus areas:\n- Item 1\n- Item 2");
      expect(renderAstToMarkdown(ast)).toBe(
        "Focus areas:\n- Item 1\n- Item 2\n",
      );
    });
  });

  describe("parseAst", () => {
    it("preserves inline formatting structure", () => {
      const ast = removePosition(parseAst("**bold**"));
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "strong",
                children: [{ type: "text", value: "bold" }],
              },
            ],
          },
        ],
      });
    });
  });

  describe("simplifyAst", () => {
    it("flattens inline formatting", () => {
      const full = parseAst("**bold** and _italic_");
      const simplified = simplifyAst(full);
      expect(simplified).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "**bold** and _italic_" }],
          },
        ],
      });
    });
  });

  describe("removePosition", () => {
    it("removes position from nested objects", () => {
      const input = {
        type: "root",
        position: { start: { line: 1 }, end: { line: 1 } },
        children: [{ type: "text", position: { start: { line: 1 } } }],
      } as const;
      const result = removePosition(input);
      expect(result).toMatchObject({
        type: "root",
        children: [{ type: "text" }],
      });
      expect("position" in result).toBe(false);
    });
  });
});

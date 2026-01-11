import { describe, it, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import type { Node } from "unist";
import { fieldSlot, type FieldSlot, type SlotPosition } from "./field-slot.ts";
import { astNode, astTextNode } from "./markdown.ts";

describe("remarkFieldSlot", () => {
  const parse = (input: string) => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(fieldSlot);
    const tree = processor.parse(input);
    return processor.runSync(tree);
  };

  const check = (input: string, expectedAst: object) => {
    expect(parse(input)).toMatchObject(expectedAst);
  };

  const findFirstSlot = (node: Node): FieldSlot | undefined => {
    if (node.type === "fieldSlot") return node as FieldSlot;
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findFirstSlot(child as Node);
        if (found) return found;
      }
    }
    return undefined;
  };

  const checkSlot = (input: string, expected: Partial<FieldSlot>) => {
    const slot = findFirstSlot(parse(input) as Node);
    expect(slot).toMatchObject(expected);
  };

  const slot = (
    value: string,
    path: string[],
    opts?: { props?: object; slotPosition?: SlotPosition },
  ): Node => {
    const node: {
      type: string;
      value: string;
      path: string[];
      props?: object;
      slotPosition?: SlotPosition;
    } = {
      type: "fieldSlot",
      value,
      path,
    };
    if (opts?.props) node.props = opts.props;
    if (opts?.slotPosition) node.slotPosition = opts.slotPosition;
    return node as unknown as Node;
  };

  describe("basic parsing", () => {
    it("parses simple slot", () =>
      check(
        "{title}",
        astNode("root", [astNode("paragraph", [slot("title", ["title"])])]),
      ));

    it("parses heading with slot", () =>
      check(
        "# {title}\n",
        astNode("root", [
          astNode("heading", { depth: 1 }, [slot("title", ["title"])]),
        ]),
      ));

    it("parses text with slot after markdown", () =>
      check(
        "**Status:** {status}\n",
        astNode("root", [
          astNode("paragraph", [
            astNode("strong", [astTextNode("Status:")]),
            astTextNode(" "),
            slot("status", ["status"]),
          ]),
        ]),
      ));

    it("parses with markdown escaping", () =>
      check(
        "\\{status\\} {title}",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("{status} "),
            slot("title", ["title"]),
          ]),
        ]),
      ));

    it("parses slot with spaces in path (stores as invalid)", () => {
      const ast = parse("{invalid field} {title}");
      expect(ast).toMatchObject(
        astNode("root", [
          astNode("paragraph", [
            astNode("fieldSlot", { value: "invalid field" }),
            astTextNode(" "),
            slot("title", ["title"]),
          ]),
        ]),
      );
    });

    it("parses nested field paths with dots", () =>
      check(
        "**Project:** {project.title}\n",
        astNode("root", [
          astNode("paragraph", [
            astNode("strong", [astTextNode("Project:")]),
            astTextNode(" "),
            slot("project.title", ["project", "title"]),
          ]),
        ]),
      ));

    it("parses deeply nested field paths", () =>
      check(
        "{parent.child.grandchild}",
        astNode("root", [
          astNode("paragraph", [
            slot("parent.child.grandchild", ["parent", "child", "grandchild"]),
          ]),
        ]),
      ));
  });

  describe("Property syntax integration", () => {
    it("parses slot with single Property", () =>
      checkSlot("{title|upper}", {
        value: "title|upper",
        path: ["title"],
        props: { upper: true },
      }));

    it("parses slot with Property and argument", () =>
      checkSlot('{date|format:"YYYY-MM-DD"}', {
        value: 'date|format:"YYYY-MM-DD"',
        path: ["date"],
        props: { format: "YYYY-MM-DD" },
      }));

    it("parses slot with chained property", () =>
      checkSlot("{items|where:true|limit:5}", {
        value: "items|where:true|limit:5",
        path: ["items"],
        props: { where: true, limit: 5 },
      }));
  });

  describe("double-brace escaping", () => {
    it("escapes {{ to literal {", () =>
      check(
        "Hello {{name}}",
        astNode("root", [astNode("paragraph", [astTextNode("Hello {name}")])]),
      ));

    it("escapes }} to literal }", () =>
      check(
        "Use {{ and }}",
        astNode("root", [astNode("paragraph", [astTextNode("Use { and }")])]),
      ));

    it("mixed escaped and real slots", () =>
      check(
        "{{escaped}} {real}",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("{escaped} "),
            slot("real", ["real"]),
          ]),
        ]),
      ));
  });

  describe("slot position detection", () => {
    describe("phrase position", () => {
      it("slot with text after", () =>
        checkSlot("{project} is active", { slotPosition: "phrase" }));
      it("slot in middle of text", () =>
        checkSlot("Title: {title}, Status: {status}", {
          slotPosition: "phrase",
        }));
      it("slot followed by comma", () =>
        checkSlot("{title}, {status}", { slotPosition: "phrase" }));
      it("slot between parentheses with text after", () =>
        checkSlot("({value}) more text", { slotPosition: "phrase" }));
      it("slot in list item with text after", () =>
        checkSlot("- {item} (pending)", { slotPosition: "phrase" }));
    });

    describe("line position", () => {
      it("slot with text before", () =>
        checkSlot("**Project:** {project}", { slotPosition: "line" }));
      it("slot in heading", () =>
        checkSlot("## {title}", { slotPosition: "line" }));
      it("slot in list item with text", () =>
        checkSlot("- Item: {value}", { slotPosition: "line" }));
      it("slot after hard break", () =>
        checkSlot("Label:  \n{value}", { slotPosition: "line" }));
    });

    describe("block position", () => {
      it("sole paragraph followed by another paragraph", () =>
        checkSlot("{content}\n\nMore text", { slotPosition: "block" }));
      it("sole paragraph followed by list", () =>
        checkSlot("{content}\n\n- item", { slotPosition: "block" }));
      it("sole paragraph in blockquote", () =>
        checkSlot("> {quote}", { slotPosition: "block" }));
      it("sole paragraph in list item", () =>
        checkSlot("- {item}", { slotPosition: "block" }));
    });

    describe("section position", () => {
      it("sole paragraph before heading", () =>
        checkSlot("{details}\n\n## Next Section", { slotPosition: "section" }));
      it("sole paragraph before thematic break", () =>
        checkSlot("{content}\n\n---", { slotPosition: "section" }));
      it("sole paragraph with other content before, at end", () =>
        checkSlot("# Title\n\n{content}", { slotPosition: "section" }));
    });

    describe("document position", () => {
      it("sole content in document with frontmatter", () =>
        checkSlot("---\ntype: Note\n---\n{content}", {
          slotPosition: "document",
        }));
      it("sole content in document without frontmatter", () =>
        checkSlot("{content}", { slotPosition: "document" }));
    });
  });

  describe("code block handling", () => {
    it("ignores {field} in inline code", () =>
      check(
        "Use `{name}` variable",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("Use "),
            astNode("inlineCode", { value: "{name}" }),
            astTextNode(" variable"),
          ]),
        ]),
      ));

    it("ignores {field} in fenced code block", () =>
      check(
        "```\n{name}\n```",
        astNode("root", [astNode("code", { value: "{name}" })]),
      ));

    it("preserves ${} as literal in inline code", () =>
      check(
        "Use `${name}` for template literals",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("Use "),
            astNode("inlineCode", { value: "${name}" }),
            astTextNode(" for template literals"),
          ]),
        ]),
      ));

    it("preserves ${} as literal in fenced code", () =>
      check(
        "```\nconst x = ${name};\n```",
        astNode("root", [astNode("code", { value: "const x = ${name};" })]),
      ));
  });
});

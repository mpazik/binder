import { describe, it, expect, it as test } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Node } from "unist";
import { remarkFieldSlot } from "./remark-field-slot.ts";
import { astNode, astTextNode } from "./markdown.ts";

describe("remarkFieldSlot", () => {
  const parse = (input: string) => {
    const processor = unified().use(remarkParse).use(remarkFieldSlot);
    const tree = processor.parse(input);
    return processor.runSync(tree);
  };

  const check = (input: string, expectedAst: object) => {
    expect(parse(input)).toMatchObject(expectedAst);
  };

  const fieldSlot = (value: string, path: string[], props?: object): Node => {
    const node: {
      type: string;
      value: string;
      path: string[];
      props?: object;
    } = {
      type: "fieldSlot",
      value,
      path,
    };
    if (props) node.props = props;
    return node as unknown as Node;
  };

  describe("basic parsing", () => {
    it("parses simple slot", () =>
      check(
        "{title}",
        astNode("root", [
          astNode("paragraph", [fieldSlot("title", ["title"])]),
        ]),
      ));

    it("parses heading with slot", () =>
      check(
        "# {title}\n",
        astNode("root", [
          astNode("heading", { depth: 1 }, [fieldSlot("title", ["title"])]),
        ]),
      ));

    it("parses text with slot after markdown", () =>
      check(
        "**Status:** {status}\n",
        astNode("root", [
          astNode("paragraph", [
            astNode("strong", [astTextNode("Status:")]),
            astTextNode(" "),
            fieldSlot("status", ["status"]),
          ]),
        ]),
      ));

    it("parses with markdown escaping", () =>
      check(
        "\\{status\\} {title}",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("{status} "),
            fieldSlot("title", ["title"]),
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
            fieldSlot("title", ["title"]),
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
            fieldSlot("project.title", ["project", "title"]),
          ]),
        ]),
      ));

    it("parses deeply nested field paths", () =>
      check(
        "{parent.child.grandchild}",
        astNode("root", [
          astNode("paragraph", [
            fieldSlot("parent.child.grandchild", [
              "parent",
              "child",
              "grandchild",
            ]),
          ]),
        ]),
      ));
  });

  describe("Property syntax integration", () => {
    it("parses slot with single Property", () =>
      check(
        "{title|upper}",
        astNode("root", [
          astNode("paragraph", [
            fieldSlot("title|upper", ["title"], { upper: true }),
          ]),
        ]),
      ));

    it("parses slot with Property and argument", () =>
      check(
        '{date|format:"YYYY-MM-DD"}',
        astNode("root", [
          astNode("paragraph", [
            fieldSlot('date|format:"YYYY-MM-DD"', ["date"], {
              format: "YYYY-MM-DD",
            }),
          ]),
        ]),
      ));

    it("parses slot with chained Propertys", () =>
      check(
        "{items|where:true|limit:5}",
        astNode("root", [
          astNode("paragraph", [
            fieldSlot("items|where:true|limit:5", ["items"], {
              where: true,
              limit: 5,
            }),
          ]),
        ]),
      ));
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
            fieldSlot("real", ["real"]),
          ]),
        ]),
      ));
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

    it("forces interpolation with ${} in inline code", () =>
      check(
        "Value is `${name}`",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("Value is "),
            astNode("inlineCode", {
              value: "${name}",
              data: {
                fieldSlots: [
                  {
                    start: 0,
                    end: 7,
                    path: ["name"],
                  },
                ],
              },
            }),
          ]),
        ]),
      ));

    it("ignores {field} in fenced code block", () =>
      check(
        "```\n{name}\n```",
        astNode("root", [astNode("code", { value: "{name}" })]),
      ));

    it("forces interpolation with ${} in fenced code", () =>
      check(
        "```\nconst x = ${name};\n```",
        astNode("root", [
          astNode("code", {
            value: "const x = ${name};",
            data: {
              fieldSlots: [
                {
                  start: 10,
                  end: 17,
                  path: ["name"],
                },
              ],
            },
          }),
        ]),
      ));

    it("escapes \\$ to produce literal ${} in inline code", () =>
      check(
        "Use `\\${name}` for template literals",
        astNode("root", [
          astNode("paragraph", [
            astTextNode("Use "),
            astNode("inlineCode", { value: "\\${name}" }),
            astTextNode(" for template literals"),
          ]),
        ]),
      ));

    it("escapes \\$ to produce literal ${} in fenced code", () =>
      check(
        "```\nconst tpl = `\\${name}`;\n```",
        astNode("root", [
          astNode("code", { value: "const tpl = `\\${name}`;" }),
        ]),
      ));

    it("mixes escaped and interpolated ${} in code", () =>
      check(
        "```\nconst a = \\${literal};\nconst b = ${name};\n```",
        astNode("root", [
          astNode("code", {
            value: "const a = \\${literal};\nconst b = ${name};",
            data: {
              fieldSlots: [
                {
                  start: 33,
                  end: 40,
                  path: ["name"],
                },
              ],
            },
          }),
        ]),
      ));
  });
});

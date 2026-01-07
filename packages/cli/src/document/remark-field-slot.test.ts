import { describe, it, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkFieldSlot } from "./remark-field-slot.ts";
import { astNode, astTextNode } from "./markdown.ts";

describe("remarkFieldSlots", () => {
  const fieldSlot = (value: string) =>
    astNode("fieldSlot", {
      value,
      data: {
        hName: "span",
        hProperties: {
          className: "field-slot",
        },
      },
    });

  const check = (input: string, expectedAst: any) => {
    const processor = unified().use(remarkParse).use(remarkFieldSlot);
    const ast = processor.parse(input);
    expect(ast).toMatchObject(expectedAst);
  };

  it("parses simple slot", () =>
    check(
      "{title}",
      astNode("root", [astNode("paragraph", [fieldSlot("title")])]),
    ));

  it("parses heading with slot", () =>
    check(
      "# {title}\n",
      astNode("root", [astNode("heading", { depth: 1 }, [fieldSlot("title")])]),
    ));

  it("parses text with slot after markdown", () =>
    check(
      "**Status:** {status}\n",
      astNode("root", [
        astNode("paragraph", [
          astNode("strong", [astTextNode("Status:")]),
          astTextNode(" "),
          fieldSlot("status"),
        ]),
      ]),
    ));

  it("parses with markdown escaping", () =>
    check(
      "\\{status\\} {title}",
      astNode("root", [
        astNode("paragraph", [astTextNode("{status} "), fieldSlot("title")]),
      ]),
    ));

  it("parses with invalid field names", () =>
    check(
      "{invalid field} {title}",
      astNode("root", [
        astNode("paragraph", [
          astTextNode("{invalid field} "),
          fieldSlot("title"),
        ]),
      ]),
    ));

  it("parses nested field paths with dots", () =>
    check(
      "**Project:** {project.title}\n",
      astNode("root", [
        astNode("paragraph", [
          astNode("strong", [astTextNode("Project:")]),
          astTextNode(" "),
          fieldSlot("project.title"),
        ]),
      ]),
    ));

  it("parses deeply nested field paths", () =>
    check(
      "{parent.child.grandchild}",
      astNode("root", [
        astNode("paragraph", [fieldSlot("parent.child.grandchild")]),
      ]),
    ));
});

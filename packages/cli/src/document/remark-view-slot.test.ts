import { describe, it, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkViewSlot } from "./remark-view-slot.ts";
import { astNode, astTextNode } from "./markdown.ts";

describe("remarkViewSlots", () => {
  const viewSlot = (value: string) =>
    astNode("viewSlot", {
      value,
      data: {
        hName: "span",
        hProperties: {
          className: "view-slot",
        },
      },
    });

  const check = (input: string, expectedAst: any) => {
    const processor = unified().use(remarkParse).use(remarkViewSlot);
    const ast = processor.parse(input);
    expect(ast).toMatchObject(expectedAst);
  };

  it("parses simple slot", () =>
    check(
      "{title}",
      astNode("root", [astNode("paragraph", [viewSlot("title")])]),
    ));

  it("parses heading with slot", () =>
    check(
      "# {title}\n",
      astNode("root", [astNode("heading", { depth: 1 }, [viewSlot("title")])]),
    ));

  it("parses text with slot after markdown", () =>
    check(
      "**Status:** {status}\n",
      astNode("root", [
        astNode("paragraph", [
          astNode("strong", [astTextNode("Status:")]),
          astTextNode(" "),
          viewSlot("status"),
        ]),
      ]),
    ));

  it("parses with markdown escaping", () =>
    check(
      "\\{status\\} {title}",
      astNode("root", [
        astNode("paragraph", [astTextNode("{status} "), viewSlot("title")]),
      ]),
    ));

  it("parses with invalid field names", () =>
    check(
      "{invalid field} {title}",
      astNode("root", [
        astNode("paragraph", [
          astTextNode("{invalid field} "),
          viewSlot("title"),
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
          viewSlot("project.title"),
        ]),
      ]),
    ));

  it("parses deeply nested field paths", () =>
    check(
      "{parent.child.grandchild}",
      astNode("root", [
        astNode("paragraph", [viewSlot("parent.child.grandchild")]),
      ]),
    ));
});

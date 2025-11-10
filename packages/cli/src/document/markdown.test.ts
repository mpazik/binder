import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "bun:test";
import { parseMarkdown, renderAstToMarkdown } from "./markdown.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const mdPath = join(__dirname, "../../test/data/document.md");
const astPath = join(__dirname, "../../test/data/document-ast.json");
const mdContent = await Bun.file(mdPath).text();

describe("parseMarkdown", () => {
  it("parses markdown with simplified AST", async () => {
    const expected = JSON.parse(await Bun.file(astPath).text());
    const ast = parseMarkdown(mdContent);
    expect(ast).toEqual(expected);
  });
});

describe("renderAstToMarkdown", () => {
  const ast = parseMarkdown(mdContent);
  const rendered = renderAstToMarkdown(ast);

  it("renders markdown with container directives", async () => {
    expect(rendered).toContain(":::dataview");
    expect(rendered).toContain(":::");
  });

  it("preserves literal markdown characters in text nodes", async () => {
    expect(rendered).toContain("**Implement user authentication**");
    expect(rendered).not.toContain("\\*\\*");
  });
});

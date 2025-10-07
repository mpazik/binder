import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import { parseMarkdown } from "./markdown.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const mdPath = join(__dirname, "../../test/data/simple.md");
const astPath = join(__dirname, "../../test/data/ast.json");

describe("parseMarkdown", () => {
  it("parses markdown with simplified AST", async () => {
    const mdContent = await Bun.file(mdPath).text();
    const ast = throwIfError(parseMarkdown(mdContent));
    const expectedText = await Bun.file(astPath).text();
    const expected = JSON.parse(expectedText);
    expect(ast).toEqual(expected);
  });
});

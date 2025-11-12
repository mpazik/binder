import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tool } from "@opencode-ai/plugin";

const specsDir = "/specs";

export default tool({
  description: `Writes a specification file to "${specsDir}" directory.
Use this tool to save implementation specifications for future reference.

Specs should be concise, behavior-focused, and avoid code examples.
Structure: Problem → Requirements → Implementation Plan → Files to Modify`,
  args: {
    title: tool.schema
      .string()
      .describe("Specification title (used for filename)"),
    markdown: tool.schema
      .string()
      .describe(
        "Specification content in markdown format - focus on behavior, not implementation details",
      ),
  },
  async execute(args) {
    const specsPath = join(process.cwd(), specsDir);

    mkdirSync(specsPath, { recursive: true });

    const filename = args.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const filePath = join(specsPath, `${filename}.md`);

    writeFileSync(filePath, args.markdown, "utf-8");

    return `✅ Specification written to ${specsDir}/${filename}.md`;
  },
});

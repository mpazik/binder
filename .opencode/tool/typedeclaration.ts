import { tool } from "@opencode-ai/plugin";
import { loadTypeDeclarationsForPrompt } from "../lib/type-declaration.ts";

export default tool({
  description: `Loads TypeScript type declarations from compiled .d.ts files.
Returns cleaned type signatures without implementation details.

Use this to:
- Understand API contracts and function signatures
- Explore available functions/types to reuse them
- Get type information before implementing changes

Example:
typedeclaration({ path: "packages/db/src/model/schema.ts" })
typedeclaration({ path: "packages/utils/src/result.ts" })
typedeclaration({ path: "packages/utils/src", include: ["result*", "option*"] })`,
  args: {
    path: tool.schema
      .string()
      .describe(
        "path to a specific .ts/.tsx file or a directory to load type declarations from",
      ),
    include: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional glob patterns to include (e.g., ['*.mock.ts']). Defaults to ['*']",
      ),
    exclude: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional glob patterns to exclude (e.g., ['*.mock.ts']). Defaults to ['*.test.ts']",
      ),
  },
  async execute({ path, include, exclude }) {
    const options: { include?: string[]; exclude?: string[] } = {};

    if (include) {
      options.include = include;
    }

    if (exclude) {
      options.exclude = exclude;
    } else {
      // Default exclude test files
      options.exclude = ["*.test.ts"];
    }

    try {
      const result = await loadTypeDeclarationsForPrompt(
        path,
        process.cwd(),
        options,
      );

      if (!result || result.trim() === "") {
        return `No type declarations found in: ${path}\n\nPossible reasons:\n- Directory doesn't exist\n- No TypeScript files match the include/exclude patterns\n- Project hasn't been built (run 'bun run build:type' to generate .d.ts files)`;
      }

      return result;
    } catch (error) {
      return `Error loading type declarations from ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

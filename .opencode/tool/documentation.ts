import { tool } from "@opencode-ai/plugin";
import {
  fetchLibraryDocumentation,
  searchLibraries,
} from "../lib/context7-client.ts";

const context7Map = {
  bun: "llmstxt/bun_sh_llms-full_txt",
  zod: "context7/zod-v4",
  drizzle: "llmstxt/orm_drizzle_team-llms.txt",
  yargs: "yargs/yargs",
  sqlite: "websites/www_sqlite_org-docs.html",
  node: "nodejs/node",
  typescript: "microsoft/typescript",
};

export default tool({
  description: `Retrieves documentation for a specified package/library`,
  args: {
    packageName: tool.schema
      .string()
      .describe(
        "Name of the package to get documentation for (e.g., 'react', 'drizzle')",
      ),
    searchPhrase: tool.schema
      .string()
      .optional()
      .describe(
        "Optional phrase to search for within the package documentation",
      ),
  },
  async execute({ packageName, searchPhrase }) {
    const packageLower = packageName.toLowerCase();
    const matchedKey = Object.keys(context7Map).find((key) =>
      packageLower.includes(key),
    );

    let context7Id: string;

    if (matchedKey) {
      context7Id = context7Map[matchedKey as keyof typeof context7Map];
    } else {
      const searchResponse = await searchLibraries(packageName);

      if (!searchResponse.results || searchResponse.results.length === 0) {
        return `No library found for "${packageName}". Please try a different search term.`;
      }

      context7Id = searchResponse.results[0]!.id;
    }

    const docs = await fetchLibraryDocumentation(context7Id, {
      topic: searchPhrase,
    });

    if (!docs) {
      return `No documentation found for package: ${packageName}`;
    }

    return docs;
  },
});

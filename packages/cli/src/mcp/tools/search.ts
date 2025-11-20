import { z } from "zod";
import { type ErrorObject, isErr, ok, type ResultAsync } from "@binder/utils";
import { FiltersSchema } from "@binder/db";
import { defineTool } from "./types.ts";

export const searchToolName = "search";

export const searchTool = defineTool({
  name: searchToolName,
  description: `Search for nodes in the knowledge graph using filters and pagination.

Use the 'schema' tool to see all available types and fields.`,
  parameters: z.object({
    filters: FiltersSchema.optional().describe(
      `Filters to apply to the search. Each key is a field name, and the value can be a simple value (string, number, boolean) or a complex filter object with 'op' and 'value' properties. Supported operators: eq, not, in, notIn, contains, notContains, match, lt, lte, gt, gte, empty
      
Filter examples:
- By type: { "type": "Task" }
- Complex filter: { "priority": { "op": "gte", "value": 5 }, "status": "done" }
      `,
    ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of results to return (default: 50)"),
    after: z.string().optional().describe("Fetch results after this cursor"),
    before: z.string().optional().describe("Fetch results before this cursor"),
  }),
  annotation: {
    readOnly: true,
  },
  async execute(args, { kg }) {
    const searchResult = await kg.search({
      filters: args.filters,
      pagination: {
        limit: args.limit,
        after: args.after,
        before: args.before,
      },
    });

    if (isErr(searchResult))
      return searchResult as unknown as ResultAsync<never, ErrorObject>;

    const { items, pagination } = searchResult.data;

    return ok({
      metadata: {
        count: items.length,
        hasNext: pagination.hasNext,
        hasPrevious: pagination.hasPrevious,
        nextCursor: pagination.nextCursor,
        previousCursor: pagination.previousCursor,
      },
      output: `Found ${items.length} node(s)`,
      structuredData: {
        items,
        pagination,
      },
    });
  },
});

import { z } from "zod";
import { isErr, ok } from "@binder/utils";
import { renderSchemaPreview } from "../../schema/schema-preview.ts";
import { defineTool } from "./types.ts";

export const schemaToolName = "schema";

export const schemaTool = defineTool({
  name: schemaToolName,
  description: `Get the complete record schema showing all available types and fields.

Use this before searching, creating records or configuration entities to understand the available structure.`,
  parameters: z.object({}),
  annotation: {
    readOnly: true,
  },
  async execute(_args, { kg }) {
    const schemaResult = await kg.getRecordSchema();
    if (isErr(schemaResult)) return schemaResult;
    const schema = schemaResult.data;

    return ok({
      metadata: {
        typeCount: Object.keys(schema.types).length,
        fieldCount: Object.keys(schema.fields).length,
      },
      output: renderSchemaPreview(schema),
    });
  },
});

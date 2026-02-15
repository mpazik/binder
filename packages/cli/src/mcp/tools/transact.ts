import { z } from "zod";
import { isErr, ok } from "@binder/utils";
import { TransactionInputSchema } from "@binder/db";
import { defineTool } from "./types.ts";

export const transactToolName = "transact";

export const transactTool = defineTool({
  name: transactToolName,
  description: `Create or update records and configuration entities in the knowledge graph.

EXAMPLES:
1. Create a new record:
{
  "records": [{
    "type": "Task",
    "key": "task-review-pr",
    "title": "Review pull request",
  }]
}

2. Update an existing record:
{
  "records": [{
    "$ref": "task-review-pr",
    "status": "done"
  }]
}

3. Create a record type (schema):
{
  "configs": [{
    "type": "Type",
    "key": "Bug",
    "name": "Bug Report",
    "description": "Track software bugs",
    "fields": ["title", "severity", "assignedTo"]
  }]
}

4. Create a relation field:
{
  "configs": [{
    "type": "RelationField",
    "key": "assignedTo",
    "name": "Assigned To",
    "dataType": "relation",
    "range": ["User"],
    "description": "Person assigned to this task"
  }]
}

5. Multiple operations:
{
  "records": [
    { "type": "Task", "title": "First task" },
    { "type": "Task", "title": "Second task" },
    { "$ref": "existing-task", "status": "done" }
  ],
  "configs": [
    { "type": "Type", "key": "Bug", "name": "Bug Report", "fields": ["title", "severity", "assignedTo"]}
  ]
}

6. Working with array fields:
{
  "records": [{
    "$ref": "task-1",
    "tags": ["insert", "urgent"]
  }]
}

Call the 'schema' tool first to understand available types, fields, and data types.`,
  parameters: z.object({
    records: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Array of record changesets to create or update records. To CREATE: include 'type' field. To UPDATE: include '$ref' field with record reference (uid, key, or id). All other fields become record attributes.",
      ),
    configs: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Array of configuration changesets to create or update schema elements. Same pattern as records: use 'type' and 'key' to create, '$ref' to update. Common config types: 'Type' (record type definition), 'Field' (field definition), 'RelationField' (relation field definition).",
      ),
  }),
  annotation: {
    readOnly: false,
    idempotent: false,
  },
  async execute(args, { kg, config }) {
    const input = TransactionInputSchema.parse({
      author: config.author,
      records: args.records,
      configs: args.configs,
    });

    const updateResult = await kg.update(input);
    if (isErr(updateResult)) return updateResult;

    const transaction = updateResult.data;
    const recordCount = Object.keys(transaction.records).length;
    const configCount = Object.keys(transaction.configs).length;

    return ok({
      metadata: {
        transactionId: transaction.id,
        transactionHash: transaction.hash,
        recordCount,
        configCount,
      },
      output: `Transaction ${transaction.id} applied: ${recordCount} record(s), ${configCount} config(s) affected`,
      structuredData: transaction,
    });
  },
});

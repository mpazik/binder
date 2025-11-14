import { z } from "zod";
import { isErr, ok } from "@binder/utils";
import { TransactionInput } from "@binder/db";
import { openDbWrite } from "../../bootstrap.ts";
import { defineTool } from "./types.ts";

export const transactToolName = "transact";

export const transactTool = defineTool({
  name: transactToolName,
  description: `Create or update nodes and configuration entities in the knowledge graph.

EXAMPLES:
1. Create a new node:
{
  "nodes": [{
    "type": "Task",
    "key": "task-review-pr",
    "title": "Review pull request",
  }]
}

2. Update an existing node:
{
  "nodes": [{
    "$ref": "task-review-pr",
    "status": "done"
  }]
}

3. Create a node type (schema):
{
  "configurations": [{
    "type": "Type",
    "key": "Bug",
    "name": "Bug Report",
    "description": "Track software bugs",
    "fields": ["title", "severity", "assignedTo"]
  }]
}

4. Create a relation field:
{
  "configurations": [{
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
  "nodes": [
    { "type": "Task", "title": "First task" },
    { "type": "Task", "title": "Second task" },
    { "$ref": "existing-task", "status": "done" }
  ],
  "configurations": [
    { "type": "Type", "key": "Bug", "name": "Bug Report", "fields": ["title", "severity", "assignedTo"]}
  ]
}

6. Working with array fields:
{
  "nodes": [{
    "$ref": "task-1",
    "tags": ["insert", "urgent"]
  }]
}

Call the 'schema' tool first to understand available types, fields, and data types.`,
  parameters: z.object({
    nodes: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Array of node changesets to create or update nodes. To CREATE: include 'type' field. To UPDATE: include '$ref' field with node reference (uid, key, or id). All other fields become node attributes.",
      ),
    configurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Array of configuration changesets to create or update schema elements. Same pattern as nodes: use 'type' and 'key' to create, '$ref' to update. Common config types: 'Type' (node type definition), 'Field' (field definition), 'RelationField' (relation field definition).",
      ),
  }),
  annotation: {
    readOnly: false,
    idempotent: false,
  },
  async execute(args, { fs, log, config }) {
    const input = TransactionInput.parse({
      author: config.author,
      nodes: args.nodes,
      configurations: args.configurations,
    });

    return openDbWrite(fs, log, config, async (kg) => {
      const updateResult = await kg.update(input);
      if (isErr(updateResult)) return updateResult;

      const transaction = updateResult.data;
      const nodeCount = Object.keys(transaction.nodes).length;
      const configCount = Object.keys(transaction.configurations).length;

      return ok({
        metadata: {
          transactionId: transaction.id,
          transactionHash: transaction.hash,
          nodeCount,
          configCount,
        },
        output: `Transaction ${transaction.id} applied: ${nodeCount} node(s), ${configCount} config(s) affected`,
        structuredData: transaction,
      });
    });
  },
});

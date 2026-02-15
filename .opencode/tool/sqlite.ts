import { tool } from "@opencode-ai/plugin";
import { executeCommand } from "../lib/execute";

export default tool({
  description: `Executes read-only SQL queries on the binder database (.binder-dev/binder.db). Returns query results in a formatted table. Use this to inspect database state, schema, and data.`,
  args: {
    query: tool.schema
      .string()
      .describe(
        "SQL query to execute (read-only: SELECT, PRAGMA). Examples: 'SELECT * FROM records LIMIT 10' or 'PRAGMA table_info(transactions)'",
      ),
  },
  async execute({ query }, context) {
    const trimmedQuery = query.trim();
    const upperQuery = trimmedQuery.toUpperCase();

    const isReadOnly =
      upperQuery.startsWith("SELECT") ||
      upperQuery.startsWith("PRAGMA") ||
      upperQuery.startsWith("EXPLAIN");

    if (!isReadOnly) {
      return `❌ Only read-only queries are allowed (SELECT, PRAGMA, EXPLAIN). Query starts with: ${trimmedQuery.split(/\s+/)[0]}`;
    }

    const dbPath = ".binder-dev/binder.db";
    const cmd = ["sqlite3", "-header", "-column", dbPath, trimmedQuery];

    const result = await executeCommand(cmd, context.abort);

    return result.success
      ? `✅ Query succeeded\n\n${result.output || "(no results)"}`
      : `❌ Query failed (exit code: ${result.exitCode})\n${result.output}`;
  },
});

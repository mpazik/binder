import { tool } from "@opencode-ai/plugin";
import { executeCommand } from "../lib/execute";

export default tool({
  description: `Executes common git commands to inspect repository state, commits, and changes. Returns formatted output for various git operations.`,
  args: {
    command: tool.schema
      .string()
      .describe(
        "Git command to execute. Examples: 'status', 'diff', 'log', 'show --name-only <commit>', 'show <commit> -- <file>'",
      ),
  },
  async execute({ command }, context) {
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return "❌ Git command cannot be empty";
    }

    // Build git command array - split by spaces but preserve quoted strings
    const cmd = [
      "git",
      ...trimmedCommand
        .split(/\s+(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
        .filter((arg) => arg),
    ];

    const result = await executeCommand(cmd, context.abort);

    return result.success
      ? `✅ Git command succeeded\n\n${result.output || "(no output)"}`
      : `❌ Git command failed (exit code: ${result.exitCode})\n${result.output}`;
  },
});

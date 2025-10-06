import { tool } from "@opencode-ai/plugin";
import { executeCommand } from "../lib/execute";

export default tool({
  description: `Runs the binder CLI with specified arguments. The CLI supports commands like 'node' and 'commit'. Use --help to see available commands.`,
  args: {
    args: tool.schema
      .string()
      .describe(
        "CLI arguments (e.g., 'node add Task title=\"new task\"' or '--help')",
      ),
  },
  async execute({ args }, context) {
    const cmdArgs = args.trim().split(/\s+/);
    const cmd = ["bun", "dev", ...cmdArgs];

    const result = await executeCommand(cmd, context.abort);

    return result.success
      ? `✅ Command succeeded\n${result.output}`
      : `❌ Command failed (exit code: ${result.exitCode})\n${result.output}`;
  },
});

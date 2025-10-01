import { tool } from "@opencode-ai/plugin";
import { getAvailableWorkspaces } from "../lib/package";
import { executeCommand, type ExecuteResult } from "../lib/execute";

const availableWorkspaces = getAvailableWorkspaces();

const AVAILABLE_STEPS = ["format", "lint", "typecheck", "test"] as const;

export default tool({
  description: `Runs a comprehensive code quality check sequence:
- Runs ESLint with auto-fix
- Formats code
- Typechecks
- Runs all tests
Use this tool when you need to verify code quality and project integrity when your changes are ready.
Optionally specify:
- module name to run checks only for that specific module
- steps to run only specific checks (e.g. ["lint", "test"])`,
  args: {
    include: tool.schema
      .enum(availableWorkspaces)
      .optional()
      .describe(
        `Optional workspace to filter commands. Available workspaces: ${availableWorkspaces.join(", ")}`,
      ),
    steps: tool.schema
      .array(tool.schema.enum(AVAILABLE_STEPS))
      .optional()
      .describe(
        `Optional list of steps to run. Available steps: ${AVAILABLE_STEPS.join(", ")}. If not specified, runs all steps.`,
      ),
  },
  async execute({ include, steps = AVAILABLE_STEPS }, context) {
    const results: Record<string, ExecuteResult> = {};

    const filterArgs = include ? ["--filter", "@binder/" + include] : [];

    const commands: Record<string, string[]> = {
      typecheck: ["bun", ...filterArgs, "typecheck"],
      test: ["bun", ...filterArgs, "test"],
      lint: ["bun", ...filterArgs, "lint"],
      format: ["bun", ...filterArgs, "format"],
    };

    for (const step of steps) {
      results[step] = await executeCommand(commands[step], context.abort);
    }

    const allSuccess = Object.values(results).every((r) => r.success);
    const failedSteps = Object.entries(results)
      .filter(([_, r]) => !r.success)
      .map(([name]) => name);

    let output = "";

    for (const [name, result] of Object.entries(results)) {
      if (!result.success || result.output.trim()) {
        output += `\n== ${name.toUpperCase()} ==\n`;
        output += `${result.output}\n`;
      }
    }

    return allSuccess
      ? `✅ All checks passed${include ? ` for module: ${include}` : ""}${output}`
      : `❌ Code check failed. Failed steps: ${failedSteps.join(", ")}\n${output}`;
  },
});

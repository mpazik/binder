import { tool } from "@opencode-ai/plugin";
import { executeCommand } from "../lib/execute";

export default tool({
  description: `Runs tests for specified files or directories. Use this tool when you need to run tests to verify code functionality or debug test failures.`,
  args: {
    path: tool.schema
      .string()
      .describe("File or directory path to run tests for"),
    testName: tool.schema
      .string()
      .optional()
      .describe("Optional filter to run only tests matching this name"),
  },
  async execute({ path, testName }, context) {
    const cmd = ["bun", "test", path];
    if (testName) {
      cmd.push("-t", testName);
    }

    const result = await executeCommand(cmd, context.abort);

    return result.success
      ? `✅ Tests passed\n${result.output}`
      : `❌ Tests failed\n${result.output}`;
  },
});

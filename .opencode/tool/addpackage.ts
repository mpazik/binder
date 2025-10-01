import { tool } from "@opencode-ai/plugin";
import { getAvailableWorkspaces } from "../lib/package";
import { executeCommand } from "../lib/execute";

const availableWorkspaces = getAvailableWorkspaces();

export default tool({
  description: `Adds npm packages to specific workspaces in the monorepo`,
  args: {
    package: tool.schema
      .string()
      .describe("Package name to install (e.g. 'lodash', '@types/node')"),
    dev: tool.schema
      .boolean()
      .meta({
        id: "dsf",
        description: "Install as dev dependency",
      })
      .optional(),
    workspace: tool.schema
      .enum(availableWorkspaces)
      .default("root")
      .describe(
        `The workspace where the package should be installed. 'root' installs at project level. Available workspaces: ${availableWorkspaces.join(", ")}`,
      ),
  },
  async execute(params, context) {
    const { package: rawPackageName, dev = false } = params;

    const workspace =
      availableWorkspaces.length === 1
        ? availableWorkspaces[0]
        : (params as any).workspace;

    const packageName =
      rawPackageName.includes("@") && !rawPackageName.startsWith("@")
        ? rawPackageName.split("@")[0]
        : rawPackageName.split("@").length > 2
          ? `@${rawPackageName.split("@")[1]}`
          : rawPackageName;

    if (
      !packageName.match(
        /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
      )
    ) {
      return `❌ Invalid package name format: ${packageName}`;
    }

    const args = ["bun", "add"];
    if (dev) args.push("--dev");
    if (workspace !== "root") {
      args.push("--cwd", `packages/${workspace}`);
    }
    args.push(packageName);

    const result = await executeCommand(args, context.abort);

    if (!result.success) {
      return `❌ Failed to add package (exit code: ${result.exitCode})\n${result.output}`;
    }

    const alreadyInstalled =
      result.output.includes("Already up to date") ||
      result.output.includes("already installed");

    const versionNote =
      rawPackageName !== packageName
        ? ` (version stripped from ${rawPackageName})`
        : "";

    return alreadyInstalled
      ? `✅ Package ${packageName} was already installed in ${workspace}${versionNote}`
      : `✅ Successfully added ${packageName} ${dev ? "as dev dependency " : ""}to ${workspace} workspace${versionNote}\n\n${result.output}`;
  },
});

import { join } from "path";
import { existsSync, readdirSync, statSync } from "fs";

export function getAvailableWorkspaces(): string[] {
  const packagesDir = join(process.cwd(), "packages");
  const workspaces = ["root"];

  if (existsSync(packagesDir)) {
    try {
      const entries = readdirSync(packagesDir);
      for (const entry of entries) {
        const entryPath = join(packagesDir, entry);
        if (
          statSync(entryPath).isDirectory() &&
          existsSync(join(entryPath, "package.json"))
        ) {
          workspaces.push(entry);
        }
      }
    } catch (error) {
      console.warn("Could not scan packages directory:", error);
    }
  }

  return workspaces;
}

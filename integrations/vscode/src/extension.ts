import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

const SCAN_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
]);

const shouldSkipDir = (name: string): boolean =>
  name.startsWith(".") || SCAN_SKIP_DIRS.has(name);

const hasBinderDir = (dirPath: string): boolean =>
  fs.existsSync(path.join(dirPath, ".binder"));

const hasBinderWorkspace = (folderPath: string): boolean => {
  if (hasBinderDir(folderPath)) return true;

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
      if (hasBinderDir(path.join(folderPath, entry.name))) return true;
    }
  } catch {
    // ignore read errors
  }
  return false;
};

export const activate = (context: vscode.ExtensionContext): void => {
  const outputChannel = vscode.window.createOutputChannel("Binder");

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    outputChannel.appendLine("No workspace folders found, skipping activation");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);

  const hasWorkspace = workspaceFolders.some((f) =>
    hasBinderWorkspace(f.uri.fsPath),
  );
  if (!hasWorkspace) {
    outputChannel.appendLine(
      "No .binder workspace found in any folder, skipping LSP",
    );
    return;
  }

  const config = vscode.workspace.getConfiguration("binder");
  const binderCmd = config.get<string>("command", "binder");
  const explicitWorkspaces = config.get<string[]>("workspaces", []);
  const traceConfig = vscode.workspace.getConfiguration("binderLsp");
  const traceLevel = traceConfig.get<string>("trace.server", "off");

  const cmdParts = binderCmd.split(" ").filter(Boolean);
  const command = cmdParts[0];
  const logLevel = config.get<string>("logLevel", "info");
  const args = [...cmdParts.slice(1), "lsp", "--log-level", logLevel];

  outputChannel.appendLine(`Starting LSP: ${command} ${args.join(" ")}`);
  outputChannel.appendLine(`Working directory: ${workspaceRoot}`);

  const initializationOptions: Record<string, unknown> = {};
  if (explicitWorkspaces.length > 0) {
    initializationOptions.workspaces = explicitWorkspaces;
    outputChannel.appendLine(
      `Explicit workspaces: ${explicitWorkspaces.join(", ")}`,
    );
  }

  client = new LanguageClient(
    "binderLsp",
    "Binder LSP",
    {
      command,
      args,
      options: {
        cwd: workspaceRoot,
      },
    },
    {
      documentSelector: [
        { scheme: "file", language: "markdown" },
        { scheme: "file", language: "yaml" },
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{md,yaml}"),
      },
      initializationOptions,
      outputChannel,
    },
  );

  if (traceLevel !== "off") {
    outputChannel.show(true);
  }

  client.start().then(
    () => {
      outputChannel.appendLine("LSP client started successfully");
    },
    (error) => {
      outputChannel.appendLine(`ERROR: Failed to start LSP: ${error.message}`);
      outputChannel.show(true);
      vscode.window.showErrorMessage(
        `Binder LSP failed to start: ${error.message}`,
      );
    },
  );

  context.subscriptions.push(client);
};

export const deactivate = (): Thenable<void> | undefined => {
  if (!client) return undefined;
  return client.stop();
};

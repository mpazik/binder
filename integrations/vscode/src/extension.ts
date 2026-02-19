import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

const isBinderWorkspace = (workspaceRoot: string): boolean => {
  const binderDir = path.join(workspaceRoot, ".binder");
  return fs.existsSync(binderDir);
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

  if (!isBinderWorkspace(workspaceRoot)) {
    outputChannel.appendLine(
      `No .binder directory found in ${workspaceRoot}, skipping activation`,
    );
    return;
  }

  const config = vscode.workspace.getConfiguration("binder");
  const binderCmd = config.get<string>("command", "binder");
  const traceConfig = vscode.workspace.getConfiguration("binderLsp");
  const traceLevel = traceConfig.get<string>("trace.server", "off");

  const cmdParts = binderCmd.split(" ").filter(Boolean);
  const command = cmdParts[0];
  const logLevel = config.get<string>("logLevel", "info");
  const args = [...cmdParts.slice(1), "lsp", "--log-level", logLevel];

  outputChannel.appendLine(`Starting LSP: ${command} ${args.join(" ")}`);
  outputChannel.appendLine(`Working directory: ${workspaceRoot}`);

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

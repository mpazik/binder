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
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  if (!isBinderWorkspace(workspaceRoot)) return;

  const config = vscode.workspace.getConfiguration("binder");
  const binderCmd = config.get<string>("command", "binder");
  const traceConfig = vscode.workspace.getConfiguration("binderLsp");
  const traceLevel = traceConfig.get<string>("trace.server", "off");

  const cmdParts = binderCmd.split(" ").filter(Boolean);
  const command = cmdParts[0];
  const logLevel = config.get<string>("logLevel", "info");
  const args = [...cmdParts.slice(1), "lsp", "--log-level", logLevel];
  const outputChannel = vscode.window.createOutputChannel("Binder");

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
    outputChannel.appendLine(
      `Binder LSP starting: ${command} ${args.join(" ")}`,
    );
    outputChannel.show(true);
  }

  client.start().catch((error) => {
    outputChannel.appendLine(`ERROR: ${error.message}`);
    outputChannel.show(true);
    vscode.window.showErrorMessage(
      `Binder LSP failed to start: ${error.message}`,
    );
  });

  context.subscriptions.push(client);
};

export const deactivate = (): Thenable<void> | undefined => {
  if (!client) return undefined;
  return client.stop();
};

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import type {
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
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
  const cliPath = config.get<string>("path", "binder");
  const traceLevel = config.get<string>("trace", "off");
  const devMode = config.get<boolean>("devMode", false);
  const command = devMode ? "bun" : cliPath;
  const args = devMode
    ? ["run", "--conditions=development", "packages/cli/src/index.ts", "lsp"]
    : ["lsp"];
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

  if (devMode || traceLevel !== "off") {
    outputChannel.appendLine(
      `Binder LSP starting in ${devMode ? "development" : "production"} mode`,
    );
  }

  if (traceLevel !== "off") {
    client.setTrace(
      traceLevel === "verbose" ? 2 : traceLevel === "messages" ? 1 : 0,
    );
  }

  if (devMode) {
    outputChannel.appendLine(`Command: ${command} ${args.join(" ")}`);
    outputChannel.show(true);

    const telemetryChannel =
      vscode.window.createOutputChannel("Binder Telemetry");

    client.onTelemetry((data) => {
      telemetryChannel.appendLine(JSON.stringify(data, null, 2));
    });
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

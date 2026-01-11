import { pathToFileURL } from "node:url";
import {
  CodeActionKind,
  type Connection,
  createConnection,
  type InitializeParams,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { isErr, tryCatch } from "@binder/utils";
import { type RuntimeContextInit } from "../runtime.ts";
import { BINDER_VERSION } from "../build-time.ts";
import { handleDocumentSave } from "./handlers/sync-handler.ts";
import { handleHover } from "./handlers/hover.ts";
import { handleCompletion } from "./handlers/completion.ts";
import { handleCodeAction } from "./handlers/code-actions.ts";
import { handleInlayHints } from "./handlers/inlay-hints.ts";
import { handleDefinition } from "./handlers/definition.ts";
import { handleDiagnostics } from "./handlers/diagnostics.ts";
import { withDocumentContext } from "./document-context.ts";
import { createWorkspaceManager } from "./workspace-manager.ts";

export const createLspServer = (
  minimalContext: RuntimeContextInit,
): Connection => {
  const connection = createConnection(
    ProposedFeatures.all,
    process.stdin,
    process.stdout,
  );
  const lspDocuments = new TextDocuments(TextDocument);
  const log = minimalContext.log;
  const { fs } = minimalContext;

  const workspaceManager = createWorkspaceManager(
    minimalContext,
    log,
    async (absolutePaths: string[]) => {
      for (const absolutePath of absolutePaths) {
        const uri = pathToFileURL(absolutePath).href;
        const openDoc = lspDocuments.get(uri);
        if (!openDoc) continue;

        const contentResult = await fs.readFile(absolutePath);
        if (isErr(contentResult)) {
          log.error("Failed to read file for refresh", {
            path: absolutePath,
            error: contentResult.error,
          });
          continue;
        }

        const fullRange = Range.create(0, 0, openDoc.lineCount, 0);

        const editResult = await tryCatch(
          connection.workspace.applyEdit({
            documentChanges: [
              {
                textDocument: { uri, version: openDoc.version },
                edits: [TextEdit.replace(fullRange, contentResult.data)],
              },
            ],
          }),
        );

        if (isErr(editResult)) {
          log.error("Failed to apply edit for document refresh", {
            uri,
            error: editResult.error,
          });
        } else if (!editResult.data.applied) {
          log.error("Edit not applied for document refresh", {
            uri,
            editResult: editResult.data,
          });
        } else {
          log.debug("Refreshed open document", { uri });
        }
      }
    },
  );
  const deps = {
    lspDocuments,
    workspaceManager,
    log,
  };

  let hasWorkspaceFolderCapability = false;

  connection.onInitialize(async (params: InitializeParams) => {
    log.info("LSP client initialized", {
      clientName: params.clientInfo?.name,
      clientVersion: params.clientInfo?.version,
    });

    log.info("Workspace folders received", {
      workspaces: params.workspaceFolders,
    });

    hasWorkspaceFolderCapability =
      params.capabilities.workspace?.workspaceFolders === true;

    // Initialize all Binder workspaces from the provided workspace folders
    const workspaceFolders = params.workspaceFolders ?? [];
    for (const folder of workspaceFolders) {
      const isBinder = await workspaceManager.isBinderWorkspace(folder.uri);
      if (isBinder) {
        await workspaceManager.initializeWorkspace(folder.uri);
      }
    }

    log.info("Workspaces loaded", {
      version: BINDER_VERSION,
      stats: workspaceManager.getStats(),
    });

    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: {
            includeText: false,
          },
        },
        diagnosticProvider: {
          interFileDependencies: false,
          workspaceDiagnostics: false,
        },
        completionProvider: {
          triggerCharacters: [":", " "],
        },
        hoverProvider: true,
        definitionProvider: true,
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
        inlayHintProvider: true,
        workspace: {
          workspaceFolders: {
            supported: true,
            changeNotifications: true,
          },
        },
      },
    };
  });

  connection.onInitialized(() => {
    log.info("LSP server initialized");

    if (hasWorkspaceFolderCapability) {
      connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
        log.info("Workspace folders changed", {
          added: event.added,
          removed: event.removed,
        });

        for (const removed of event.removed) {
          await workspaceManager.disposeWorkspace(removed.uri);
        }

        for (const added of event.added) {
          const isBinder = await workspaceManager.isBinderWorkspace(added.uri);
          if (isBinder) {
            await workspaceManager.initializeWorkspace(added.uri);
          }
        }
      });
    }
  });

  let shutdownReceived = false;

  connection.onShutdown(async () => {
    log.info("LSP server shutdown requested", workspaceManager.getStats());
    await workspaceManager.disposeAll();
    shutdownReceived = true;
    return undefined;
  });

  connection.onExit(() => {
    log.info("LSP server exit", { shutdownReceived });
    const exitCode = shutdownReceived ? 0 : 1;
    process.exit(exitCode);
  });

  lspDocuments.onDidOpen(async (event) => {
    log.debug("Document opened", { uri: event.document.uri });
  });

  lspDocuments.onDidChangeContent(async (change) => {
    log.debug("Document changed", { uri: change.document.uri });
  });

  lspDocuments.onDidClose(async (event) => {
    const uri = event.document.uri;
    log.info("Document closed", { uri });

    const workspace = await workspaceManager.findWorkspaceForDocument(uri);
    if (workspace) {
      workspace.documentCache.invalidate(uri);
    }
  });

  lspDocuments.onDidSave(async (change) => {
    const uri = change.document.uri;
    log.info("Document saved", { uri });

    const workspace = await workspaceManager.findWorkspaceForDocument(uri);
    if (!workspace) {
      log.debug("Document not in any Binder workspace, skipping sync", { uri });
      return;
    }

    const result = await handleDocumentSave(workspace.runtime, uri);

    if (isErr(result)) {
      log.error("Sync failed", { error: result.error, uri });
    }
  });

  connection.onCompletion(
    withDocumentContext("Completion", deps, handleCompletion),
  );

  connection.onHover(withDocumentContext("Hover", deps, handleHover));

  connection.onDefinition(
    withDocumentContext("Definition", deps, handleDefinition),
  );

  connection.onCodeAction(
    withDocumentContext("Code action", deps, handleCodeAction),
  );

  connection.languages.inlayHint.on(
    withDocumentContext("Inlay hints", deps, handleInlayHints),
  );

  connection.languages.diagnostics.on(async (params) => {
    const result = await withDocumentContext(
      "Diagnostics",
      deps,
      handleDiagnostics,
    )(params);
    return result ?? { kind: "full", items: [] };
  });

  lspDocuments.listen(connection);
  connection.listen();

  return connection;
};

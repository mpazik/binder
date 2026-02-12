import {
  CodeActionKind,
  type Connection,
  createConnection,
  type InitializeParams,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { isErr } from "@binder/utils";
import { type RuntimeContextInit } from "../runtime.ts";
import { BINDER_VERSION } from "../build-time.ts";
import { handleDocumentSave } from "./handlers/save-handler.ts";
import { handleHover } from "./handlers/hover.ts";
import { handleCompletion } from "./handlers/completion.ts";
import { handleCodeAction } from "./handlers/code-actions.ts";
import { handleInlayHints } from "./handlers/inlay-hints.ts";
import { handleDefinition } from "./handlers/definition.ts";
import { handleDiagnostics } from "./handlers/diagnostics.ts";
import { handleSemanticTokens } from "./handlers/semantic-tokens.ts";
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
      // Rendered files are already written to disk by saveSnapshot.
      // We do NOT send applyEdit — let the editor's file watcher detect
      // the disk change and reload silently. Sending both a disk write
      // and applyEdit races and causes intermittent conflict dialogs.
      log.info("Files rendered to disk", {
        fileCount: absolutePaths.length,
        paths: absolutePaths,
      });
    },
  );
  const deps = {
    lspDocuments,
    workspaceManager,
    log,
  };

  let hasWorkspaceFolderCapability = false;

  connection.onInitialize(async (params: InitializeParams) => {
    const caps = params.capabilities.textDocument;

    log.info("LSP client initialized", {
      clientName: params.clientInfo?.name,
      clientVersion: params.clientInfo?.version,
      semanticTokens: !!caps?.semanticTokens,
      hover: !!caps?.hover,
      completion: !!caps?.completion,
      definition: !!caps?.definition,
      diagnostics: !!caps?.diagnostic,
      inlayHint: !!caps?.inlayHint,
      codeAction: !!caps?.codeAction,
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
        // disabled until exact tokens are figured out
        // semanticTokensProvider: {
        //   legend: {
        //     tokenTypes: [...TOKEN_TYPES],
        //     tokenModifiers: [...TOKEN_MODIFIERS],
        //   },
        //   full: true,
        // },
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

    const workspace = workspaceManager.findWorkspaceForDocument(uri);
    if (workspace) {
      workspace.documentCache.invalidate(uri);
    }
  });

  lspDocuments.onDidSave(async (change) => {
    const uri = change.document.uri;

    const workspace = workspaceManager.findWorkspaceForDocument(uri);
    if (!workspace) {
      log.debug("Document not in any Binder workspace, skipping sync", { uri });
      return;
    }

    // Use open document content as canonical source (avoids disk races
    // from editor safe-write / atomic-rename save strategies).
    const sourceContent = lspDocuments.get(uri)?.getText();

    const result = await handleDocumentSave(
      workspace.runtime,
      uri,
      sourceContent,
    );

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

  connection.languages.semanticTokens.on(async (params) => {
    const result = await withDocumentContext(
      "Semantic tokens",
      deps,
      handleSemanticTokens,
    )(params);
    return result ?? { data: [] };
  });

  lspDocuments.listen(connection);
  connection.listen();

  return connection;
};

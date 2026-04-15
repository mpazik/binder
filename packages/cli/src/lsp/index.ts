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
import type { RuntimeContextInit } from "../runtime.ts";
import { BINDER_VERSION } from "../environment.ts";
import { track, forceFlush } from "../telemetry.ts";
import { handleDocumentSave } from "./handlers/save-handler.ts";
import { handleHover } from "./handlers/hover.ts";
import { handleCompletion } from "./handlers/completion.ts";
import { handleCodeAction } from "./handlers/code-actions.ts";
import { handleInlayHints } from "./handlers/inlay-hints.ts";
import { handleDefinition } from "./handlers/definition.ts";
import { handleDiagnostics } from "./handlers/diagnostics.ts";
import { handleSemanticTokens } from "./handlers/semantic-tokens.ts";
import { withDocumentContext } from "./document-context.ts";
import {
  createWorkspaceManager,
  type WorkspaceManager,
  withWorkspaceContext,
} from "./workspace-manager.ts";

const initializeBinderWorkspaces = async (
  workspaceManager: WorkspaceManager,
  folderUris: string[],
): Promise<void> => {
  for (const uri of folderUris) {
    if (await workspaceManager.isBinderWorkspace(uri)) {
      await workspaceManager.initializeWorkspace(uri);
    }
  }
};

export const createLspServer = (
  minimalContext: RuntimeContextInit,
): Connection => {
  const connection = createConnection(
    ProposedFeatures.all,
    process.stdin,
    process.stdout,
  );
  const lspDocuments = new TextDocuments(TextDocument);
  const { log, telemetry } = minimalContext;
  const startedAt = Date.now();
  let sessionTracked = false;
  let trackLspSession = () => {};

  const workspaceManager = createWorkspaceManager(
    minimalContext,
    log,
    // Let the editor's file watcher detect disk changes and reload silently.
    // Sending both a disk write and applyEdit races and causes conflict dialogs.
    async () => {},
  );
  const ctx = { connection, lspDocuments, workspaceManager, log, telemetry };

  trackLspSession = () => {
    if (sessionTracked) return;
    sessionTracked = true;

    track(telemetry, {
      event: "lsp_session",
      duration_ms: Date.now() - startedAt,
      workspaces: workspaceManager.getStats().workspaceCount,
    });

    forceFlush(telemetry, { projectRoot: process.cwd() });
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

    await initializeBinderWorkspaces(
      workspaceManager,
      (params.workspaceFolders ?? []).map((f) => f.uri),
    );

    log.info("Workspaces loaded", {
      version: BINDER_VERSION,
      stats: workspaceManager.getStats(),
    });

    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: { includeText: false },
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

        await initializeBinderWorkspaces(
          workspaceManager,
          event.added.map((f) => f.uri),
        );
      });
    }
  });

  let shutdownReceived = false;

  connection.onShutdown(async () => {
    log.info("LSP server shutdown requested", workspaceManager.getStats());
    await workspaceManager.disposeAll();
    shutdownReceived = true;
    trackLspSession();
    return undefined;
  });

  connection.onExit(() => {
    log.info("LSP server exit", { shutdownReceived });
    trackLspSession();
    process.exit(shutdownReceived ? 0 : 1);
  });

  lspDocuments.onDidOpen(
    withWorkspaceContext(ctx, "didOpen", async (_ctx, event, { runtime }) => {
      runtime.log.debug("Document opened", { uri: event.document.uri });
    }),
  );

  lspDocuments.onDidChangeContent(
    withWorkspaceContext(ctx, "didChange", async (_ctx, event, { runtime }) => {
      runtime.log.debug("Document changed", { uri: event.document.uri });
    }),
  );

  lspDocuments.onDidClose(
    withWorkspaceContext(ctx, "didClose", async (_ctx, event, workspace) => {
      const uri = event.document.uri;
      workspace.runtime.log.info("Document closed", { uri });
      workspace.documentCache.invalidate(uri);
    }),
  );

  lspDocuments.onDidSave(
    withWorkspaceContext(
      ctx,
      "didSave",
      async (c, event, workspace) => {
        await handleDocumentSave(c, event, workspace);
      },
      { telemetry: "save_sync" },
    ),
  );

  connection.onCompletion(
    withDocumentContext(ctx, "Completion", handleCompletion, {
      telemetry: "completion",
    }),
  );

  connection.onHover(
    withDocumentContext(ctx, "Hover", handleHover, { telemetry: "hover" }),
  );

  connection.onDefinition(
    withDocumentContext(ctx, "Definition", handleDefinition, {
      telemetry: "definition",
    }),
  );

  connection.onCodeAction(
    withDocumentContext(ctx, "Code action", handleCodeAction, {
      telemetry: "code_action",
    }),
  );

  connection.languages.inlayHint.on(
    withDocumentContext(ctx, "Inlay hints", handleInlayHints),
  );

  connection.languages.diagnostics.on(async (params) => {
    const result = await withDocumentContext(
      ctx,
      "Diagnostics",
      handleDiagnostics,
      { telemetry: "diagnostics" },
    )(params);
    return result ?? { kind: "full", items: [] };
  });

  connection.languages.semanticTokens.on(async (params) => {
    const result = await withDocumentContext(
      ctx,
      "Semantic tokens",
      handleSemanticTokens,
    )(params);
    return result ?? { data: [] };
  });

  lspDocuments.listen(connection);
  connection.listen();

  return connection;
};

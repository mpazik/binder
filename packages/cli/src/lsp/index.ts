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
  createLspCounters,
  createWorkspaceManager,
  withWorkspaceContext,
} from "./workspace-manager.ts";

type InitializationOptions = {
  workspaces?: string[];
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

  // No-op: let the editor's file watcher detect disk changes and reload
  // silently. Sending both a disk write and applyEdit races and causes conflict dialogs.
  const workspaceManager = createWorkspaceManager(
    minimalContext,
    log,
    async () => {},
  );
  const counters = createLspCounters();
  const ctx = {
    connection,
    lspDocuments,
    workspaceManager,
    log,
    telemetry,
    counters,
  };

  trackLspSession = () => {
    if (sessionTracked) return;
    sessionTracked = true;

    track(telemetry, {
      event: "lsp.session",
      duration_ms: Date.now() - startedAt,
      workspaces: workspaceManager.getStats().workspaceCount,
      ...counters,
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

    const { workspaces: explicitPaths } = (params.initializationOptions ??
      {}) as InitializationOptions;

    for (const folder of params.workspaceFolders ?? []) {
      await workspaceManager.discoverWorkspaces(folder.uri, explicitPaths);
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
          await workspaceManager.disposeWorkspacesUnder(removed.uri);
        }

        for (const added of event.added) {
          await workspaceManager.discoverWorkspaces(added.uri);
        }
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
      { telemetry: "save_sync_count" },
    ),
  );

  connection.onCompletion(
    withDocumentContext(ctx, "Completion", handleCompletion, {
      telemetry: "completion_count",
    }),
  );

  connection.onHover(
    withDocumentContext(ctx, "Hover", handleHover, {
      telemetry: "hover_count",
    }),
  );

  connection.onDefinition(
    withDocumentContext(ctx, "Definition", handleDefinition, {
      telemetry: "definition_count",
    }),
  );

  connection.onCodeAction(
    withDocumentContext(ctx, "Code action", handleCodeAction, {
      telemetry: "code_action_count",
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
      { telemetry: "diagnostics_count" },
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

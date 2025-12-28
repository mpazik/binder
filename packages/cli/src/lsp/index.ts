import { fileURLToPath } from "node:url";
import {
  CodeActionKind,
  type Connection,
  createConnection,
  ErrorCodes,
  type InitializeParams,
  ProposedFeatures,
  ResponseError,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { type ErrorObject, isErr } from "@binder/utils";
import {
  initializeDbRuntime,
  initializeRuntime,
  type RuntimeContextInit,
  type RuntimeContextWithDb,
} from "../runtime.ts";
import { setupCleanupHandlers } from "../lib/lock.ts";
import type { Logger } from "../log.ts";
import { BINDER_VERSION } from "../build-time.ts";
import { handleDocumentSave } from "./sync-handler.ts";
import { createDocumentCache, type DocumentCache } from "./document-cache.ts";
import { handleHover } from "./hover.ts";
import { handleCompletion } from "./completion.ts";
import { handleCodeAction } from "./code-actions.ts";
import { handleInlayHints } from "./inlay-hints.ts";
import { handleDefinition } from "./definition.ts";
import { handleDiagnostics } from "./diagnostics.ts";
import { withDocumentContext } from "./lsp-utils.ts";

const throwLspError = (
  error: ErrorObject,
  log: Logger,
  message: string,
): never => {
  log.error(message, error);
  // eslint-disable-next-line no-restricted-syntax
  throw new ResponseError(
    ErrorCodes.InternalError,
    `${message}: ${error.message}`,
    error,
  );
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
  let log = minimalContext.log;

  let runtime: RuntimeContextWithDb | null = null;
  let documentCache: DocumentCache = createDocumentCache(log);

  connection.onInitialize(async (params: InitializeParams) => {
    log.info("LSP client initialized", {
      clientName: params.clientInfo?.name,
      clientVersion: params.clientInfo?.version,
    });

    const rootUri =
      params.workspaceFolders && params.workspaceFolders.length > 0
        ? params.workspaceFolders[0].uri
        : params.rootUri;

    if (!rootUri) {
      log.error("No workspace root provided by LSP client");
      // We can't initialize without a root. Return empty capabilities to disable server effectively.
      return { capabilities: {} };
    }

    const rootPath = fileURLToPath(rootUri);
    log.info("Initializing workspace", { rootPath });

    const runtimeResult = await initializeRuntime(
      {
        ...minimalContext,
        silent: true,
        logFile: "lsp.log",
      },
      rootPath,
    );
    if (isErr(runtimeResult))
      throwLspError(
        runtimeResult.error,
        log,
        "Failed to initialize Binder workspace",
      );

    const runtimeContext = runtimeResult.data!;
    log = runtimeContext.log; // promote to local logger

    const runtimeWithDbResult = await initializeDbRuntime(runtimeContext);
    if (isErr(runtimeWithDbResult))
      throwLspError(
        runtimeWithDbResult.error,
        log,
        "Failed to initialize Binder database",
      );

    setupCleanupHandlers(runtimeContext.fs, runtimeContext.config.paths.binder);

    runtime = { ...runtimeContext, ...runtimeWithDbResult.data! };
    documentCache = createDocumentCache(log);

    log.info("Workspace loaded", {
      version: BINDER_VERSION,
      cwd: runtimeContext.config.paths.root,
      logLevel: minimalContext.logLevel,
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
      },
    };
  });

  connection.onInitialized(() => {
    log.info("LSP server initialized");
  });

  let shutdownReceived = false;

  connection.onShutdown(() => {
    log.info("LSP server shutdown requested");
    log.info("Document cache stats", documentCache.getStats());
    shutdownReceived = true;
    return undefined;
  });

  connection.onExit(() => {
    log.info("LSP server exit", { shutdownReceived });
    const exitCode = shutdownReceived ? 0 : 1;
    process.exit(exitCode);
  });

  lspDocuments.onDidOpen(async (event) => {
    log.info("Document opened", { uri: event.document.uri });
  });

  lspDocuments.onDidChangeContent(async (change) => {
    log.debug("Document changed", { uri: change.document.uri });
  });

  lspDocuments.onDidClose((event) => {
    const uri = event.document.uri;
    log.info("Document closed", { uri });
    documentCache.invalidate(uri);
  });

  lspDocuments.onDidSave(async (change) => {
    const uri = change.document.uri;
    log.info("Document saved", { uri });

    if (!runtime) {
      log.error("Workspace not initialized, cannot sync file", { uri });
      return;
    }

    const result = await handleDocumentSave(runtime, uri);

    if (isErr(result)) {
      log.error("Sync failed", { error: result.error, uri });
    }
  });

  const deps = {
    lspDocuments,
    documentCache,
    runtime,
    log,
  };

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

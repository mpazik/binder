import { fileURLToPath } from "node:url";
import {
  type CodeAction,
  CodeActionKind,
  type CodeActionParams,
  type CompletionItem,
  type CompletionParams,
  type Connection,
  createConnection,
  type DefinitionParams,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentDiagnosticReport,
  ErrorCodes,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type Location,
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
import {
  validateDocument,
  type ValidationError,
  type ValidationSeverity,
} from "../validation";
import {
  findNavigationItemByPath,
  loadNavigation,
} from "../document/navigation.ts";
import { BINDER_VERSION } from "../build-time.ts";
import {
  getRelativeSnapshotPath,
  namespaceFromSnapshotPath,
} from "../lib/snapshot.ts";
import { handleDocumentSave } from "./sync-handler.ts";
import { createDocumentCache, type DocumentCache } from "./document-cache.ts";
import { handleHover } from "./hover.ts";
import { handleCompletion } from "./completion.ts";
import { handleCodeAction } from "./code-actions.ts";
import { handleInlayHints } from "./inlay-hints.ts";
import { handleDefinition } from "./definition.ts";

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

const severityToDiagnosticSeverity: Record<
  ValidationSeverity,
  DiagnosticSeverity
> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

const EMPTY_DIAGNOSTICS: DocumentDiagnosticReport = {
  kind: "full",
  items: [],
} as const;

const validationErrorToDiagnostic = (error: ValidationError): Diagnostic => ({
  range: error.range,
  severity: severityToDiagnosticSeverity[error.severity],
  message: error.message,
  source: "binder",
  code: error.code,
  data: error.data,
});

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
    const stats = documentCache.getStats();
    log.info("Document cache stats", stats);
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

  connection.languages.diagnostics.on(async (params) => {
    log.info("Diagnostic request received", { uri: params.textDocument.uri });

    if (!runtime) {
      log.warn("Runtime not initialized, returning empty diagnostics");
      return EMPTY_DIAGNOSTICS;
    }
    const { kg, config, fs } = runtime;

    const uri = params.textDocument.uri;
    const document = lspDocuments.get(uri);

    if (!document) {
      log.warn("Document not found", { uri });
      return EMPTY_DIAGNOSTICS;
    }

    const content = documentCache.getParsed(document);
    if (!content) {
      log.debug("Document type not supported", { uri });
      return EMPTY_DIAGNOSTICS;
    }

    const filePath = fileURLToPath(uri);
    log.debug("validateDocument called", { filePath });
    const ruleConfig = config.validation?.rules ?? {};

    const namespace = namespaceFromSnapshotPath(filePath, config.paths);
    if (namespace === undefined) {
      log.debug("Document from outside binder directories", { filePath });
      return EMPTY_DIAGNOSTICS;
    }
    const schemaResult = await runtime.kg.getSchema(namespace);
    if (isErr(schemaResult)) {
      log.error("Failed to load schema", schemaResult.error);
      return EMPTY_DIAGNOSTICS;
    }

    const navigationResult = await loadNavigation(kg, namespace);
    if (isErr(navigationResult)) {
      log.error("Failed to load navigation", navigationResult.error);
      return EMPTY_DIAGNOSTICS;
    }

    const relativePath = getRelativeSnapshotPath(filePath, config.paths);
    log.debug("Resolved relative path", { filePath, relativePath });

    const navigationItem = findNavigationItemByPath(
      navigationResult.data,
      relativePath,
    );

    if (!navigationItem) {
      log.debug("No navigation item found", { filePath, relativePath });
      return EMPTY_DIAGNOSTICS;
    }

    const validationResult = await validateDocument(content, {
      filePath,
      navigationItem,
      namespace,
      schema: schemaResult.data,
      ruleConfig,
      kg,
    });

    const diagnostics = [
      ...validationResult.errors,
      ...validationResult.warnings,
    ].map(validationErrorToDiagnostic);

    log.info("Returning diagnostics", {
      filePath,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
    });

    return {
      kind: "full",
      items: diagnostics,
    };
  });

  connection.onCompletion(
    async (params: CompletionParams): Promise<CompletionItem[]> => {
      log.debug("Completion request received", {
        uri: params.textDocument.uri,
      });
      if (!runtime) return [];
      return handleCompletion(
        params,
        lspDocuments,
        documentCache,
        runtime,
        log,
      );
    },
  );

  connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
    log.debug("Hover request received", { uri: params.textDocument.uri });
    if (!runtime) return null;
    return handleHover(params, lspDocuments, documentCache, runtime, log);
  });

  connection.onDefinition(
    async (params: DefinitionParams): Promise<Location | null> => {
      log.debug("Definition request received", {
        uri: params.textDocument.uri,
      });
      if (!runtime) return null;
      return handleDefinition(
        params,
        lspDocuments,
        documentCache,
        runtime,
        log,
      );
    },
  );

  connection.onCodeAction(
    async (params: CodeActionParams): Promise<CodeAction[]> => {
      log.debug("Code action request received", {
        uri: params.textDocument.uri,
      });
      if (!runtime) return [];
      return handleCodeAction(
        params,
        lspDocuments,
        documentCache,
        runtime,
        log,
      );
    },
  );

  connection.languages.inlayHint.on(async (params) => {
    log.debug("Inlay hints request received", { uri: params.textDocument.uri });
    if (!runtime) return [];
    return handleInlayHints(params, lspDocuments, documentCache, runtime, log);
  });

  lspDocuments.listen(connection);
  connection.listen();

  return connection;
};

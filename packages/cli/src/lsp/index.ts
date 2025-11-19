import { fileURLToPath } from "node:url";
import {
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
import { handleDocumentSave } from "./sync-handler.ts";

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
  const { log } = minimalContext;

  const connection = createConnection(
    ProposedFeatures.all,
    process.stdin,
    process.stdout,
  );
  const documents = new TextDocuments(TextDocument);

  let runtime: RuntimeContextWithDb | null = null;

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
        logLevel: "INFO",
        printLogs: false,
        silent: true,
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

    const dbResult = await initializeDbRuntime(runtimeContext);
    if (isErr(dbResult))
      throwLspError(
        dbResult.error,
        log,
        "Failed to initialize Binder database",
      );

    setupCleanupHandlers(runtimeContext.fs, runtimeContext.config.paths.binder);

    runtime = {
      ...runtimeContext,
      db: dbResult.data!.db,
      kg: dbResult.data!.kg,
    };

    log.info("Workspace initialized", {
      root: runtime.config.paths.root,
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
      },
    };
  });

  connection.onInitialized(() => {
    log.info("LSP server initialized");
  });

  let shutdownReceived = false;

  connection.onShutdown(() => {
    log.info("LSP server shutdown requested");
    shutdownReceived = true;
    return undefined;
  });

  connection.onExit(() => {
    log.info("LSP server exit", { shutdownReceived });
    const exitCode = shutdownReceived ? 0 : 1;
    process.exit(exitCode);
  });

  documents.onDidSave(async (change) => {
    const uri = change.document.uri;
    log.debug("Document saved", { uri });

    if (!runtime) {
      log.error("Workspace not initialized, cannot sync file", { uri });
      connection.sendDiagnostics({
        uri,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            message: "Workspace not initialized",
            severity: 1, // Error
          },
        ],
      });
      return;
    }

    const result = await handleDocumentSave(runtime, uri);

    if (isErr(result)) {
      log.error("Sync failed", { error: result.error, uri });
      connection.sendDiagnostics({
        uri,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            message: `Sync failed: ${result.error.message}`,
            severity: 1, // Error
          },
        ],
      });
    } else {
      connection.sendDiagnostics({
        uri,
        diagnostics: [],
      });
    }
  });

  documents.listen(connection);
  connection.listen();

  return connection;
};

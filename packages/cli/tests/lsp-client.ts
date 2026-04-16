import { type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type {
  CodeAction,
  CompletionItem,
  DocumentDiagnosticReport,
  Hover,
  InlayHint,
  InitializeResult,
  Location,
  SemanticTokens,
  TextEdit,
} from "vscode-languageserver-protocol";
import { tryCatch } from "@binder/utils";

export type LspClient = ReturnType<typeof createLspClient>;

export const createLspClient = (child: ChildProcess) => {
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout!),
    new StreamMessageWriter(child.stdin!),
  );

  connection.listen();

  const versions = new Map<string, number>();

  const sendPositionRequest = <T>(
    method: string,
    uri: string,
    line: number,
    character: number,
  ) =>
    connection.sendRequest(method, {
      textDocument: { uri },
      position: { line, character },
    }) as Promise<T>;

  const sendRangeRequest = <T>(
    method: string,
    uri: string,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    extra?: Record<string, unknown>,
  ) =>
    connection.sendRequest(method, {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      ...extra,
    }) as Promise<T>;

  return {
    connection,
    process: child,

    initialize: async (
      workspaceDir: string | string[],
      initializationOptions?: Record<string, unknown>,
    ): Promise<InitializeResult> => {
      const dirs = Array.isArray(workspaceDir) ? workspaceDir : [workspaceDir];
      const result = await connection.sendRequest("initialize", {
        processId: process.pid,
        capabilities: {
          textDocument: {
            completion: { completionItem: {} },
            hover: {},
            diagnostic: {},
          },
          workspace: { workspaceFolders: true },
        },
        workspaceFolders: dirs.map((d, i) => ({
          uri: pathToFileURL(d).toString(),
          name: `workspace-${i}`,
        })),
        ...(initializationOptions ? { initializationOptions } : {}),
      });
      connection.sendNotification("initialized", {});
      await new Promise((r) => setTimeout(r, 500));
      return result as InitializeResult;
    },

    shutdown: async () => {
      await tryCatch(async () => {
        await connection.sendRequest("shutdown");
        connection.sendNotification("exit");
      });
      connection.dispose();
      child.kill();
    },

    openDocument: (uri: string, text: string, languageId?: string) => {
      const lang =
        languageId ??
        (uri.endsWith(".yaml") || uri.endsWith(".yml") ? "yaml" : "markdown");

      if (versions.has(uri)) {
        const version = versions.get(uri)! + 1;
        versions.set(uri, version);
        connection.sendNotification("textDocument/didChange", {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
      } else {
        versions.set(uri, 1);
        connection.sendNotification("textDocument/didOpen", {
          textDocument: { uri, languageId: lang, version: 1, text },
        });
      }
    },

    saveDocument: (uri: string) => {
      connection.sendNotification("textDocument/didSave", {
        textDocument: { uri },
      });
    },

    hover: (
      uri: string,
      line: number,
      character: number,
    ): Promise<Hover | null> =>
      sendPositionRequest("textDocument/hover", uri, line, character),

    completion: async (
      uri: string,
      line: number,
      character: number,
    ): Promise<CompletionItem[]> => {
      const result = await sendPositionRequest(
        "textDocument/completion",
        uri,
        line,
        character,
      );
      if (!result) return [];
      if (Array.isArray(result)) return result as CompletionItem[];
      return (result as { items: CompletionItem[] }).items ?? [];
    },

    diagnostics: (uri: string): Promise<DocumentDiagnosticReport> =>
      connection.sendRequest("textDocument/diagnostic", {
        textDocument: { uri },
      }) as Promise<DocumentDiagnosticReport>,

    definition: (
      uri: string,
      line: number,
      character: number,
    ): Promise<Location | Location[] | null> =>
      sendPositionRequest("textDocument/definition", uri, line, character),

    codeActions: async (
      uri: string,
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
      diagnostics: unknown[] = [],
    ): Promise<CodeAction[]> => {
      const result = await sendRangeRequest<CodeAction[] | null>(
        "textDocument/codeAction",
        uri,
        startLine,
        startChar,
        endLine,
        endChar,
        { context: { diagnostics } },
      );
      return result ?? [];
    },

    inlayHints: async (
      uri: string,
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    ): Promise<InlayHint[]> => {
      const result = await sendRangeRequest<InlayHint[] | null>(
        "textDocument/inlayHint",
        uri,
        startLine,
        startChar,
        endLine,
        endChar,
      );
      return result ?? [];
    },

    semanticTokens: (uri: string): Promise<SemanticTokens> =>
      connection.sendRequest("textDocument/semanticTokens/full", {
        textDocument: { uri },
      }) as Promise<SemanticTokens>,

    applyCodeAction: (
      action: CodeAction,
      uri: string,
      text: string,
    ): string => {
      const edits = action.edit?.changes?.[uri];
      if (!edits || edits.length === 0) return text;

      // Apply edits bottom-to-top so offsets stay valid
      const sorted = [...edits].sort((a, b) =>
        b.range.start.line !== a.range.start.line
          ? b.range.start.line - a.range.start.line
          : b.range.start.character - a.range.start.character,
      );

      const lines = text.split("\n");
      for (const edit of sorted as TextEdit[]) {
        const { start, end } = edit.range;
        if (start.line === end.line) {
          const line = lines[start.line]!;
          lines[start.line] =
            line.slice(0, start.character) +
            edit.newText +
            line.slice(end.character);
        } else {
          const before = lines[start.line]!.slice(0, start.character);
          const after = lines[end.line]!.slice(end.character);
          const newLines = (before + edit.newText + after).split("\n");
          lines.splice(start.line, end.line - start.line + 1, ...newLines);
        }
      }
      return lines.join("\n");
    },
  };
};

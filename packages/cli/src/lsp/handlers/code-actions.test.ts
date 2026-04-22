import { describe, expect, it } from "bun:test";
import type { CodeAction, Diagnostic, Range } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { mockRecordSchema, mockTaskType } from "@binder/repo/mocks";
import type { DocumentContext } from "../document-context.ts";
import { handleCodeAction } from "./code-actions.ts";

const createMockDiagnostic = (
  code: string,
  range: Range,
  data?: Record<string, unknown>,
): Diagnostic => ({
  range,
  severity: DiagnosticSeverity.Error,
  message: "Test diagnostic",
  source: "binder",
  code,
  data,
});

const createMockDocument = (content: string, uri = "file:///test.yaml") =>
  TextDocument.create(uri, "yaml", 1, content);

const createMockContext = (
  documentType: "yaml" | "markdown" = "yaml",
): DocumentContext =>
  ({
    documentType,
    schema: mockRecordSchema,
    typeDef: mockTaskType,
    entityMappings: { kind: "single", mapping: { status: "new" } },
  }) as unknown as DocumentContext;

const mockLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const mockRuntime = { log: mockLog } as never;

const getActions = (
  document: ReturnType<typeof createMockDocument>,
  diagnostic: Diagnostic,
  context: DocumentContext,
): CodeAction[] =>
  handleCodeAction(
    {
      textDocument: { uri: document.uri },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    },
    { document, context, runtime: mockRuntime },
  ) as CodeAction[];

describe("code-actions", () => {
  describe("invalid-value", () => {
    const range: Range = {
      start: { line: 0, character: 8 },
      end: { line: 0, character: 15 },
    };

    it("suggests similar options for misspelled option value", () => {
      const document = createMockDocument("status: pendng");
      const diagnostic = createMockDiagnostic("invalid-value", range, {
        fieldKey: "status",
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([
        expect.objectContaining({ title: "Replace with 'pending'" }),
      ]);
    });

    it("suggests multiple options when similar", () => {
      const document = createMockDocument("status: activ");
      const diagnostic = createMockDiagnostic("invalid-value", range, {
        fieldKey: "status",
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([
        expect.objectContaining({ title: "Replace with 'active'" }),
      ]);
    });

    it("returns empty array when no similar options found", () => {
      const document = createMockDocument("status: xyz");
      const diagnostic = createMockDiagnostic("invalid-value", range, {
        fieldKey: "status",
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([]);
    });

    it("works with fieldPath from markdown diagnostics", () => {
      const document = createMockDocument("status: pendng");
      const diagnostic = createMockDiagnostic("invalid-value", range, {
        fieldPath: ["status"],
      });

      const actions = getActions(
        document,
        diagnostic,
        createMockContext("markdown"),
      );

      expect(actions).toEqual([
        expect.objectContaining({ title: "Replace with 'pending'" }),
      ]);
    });

    it("returns empty array for non-option field types", () => {
      const document = createMockDocument("favorite: notboolean");
      const diagnostic = createMockDiagnostic(
        "invalid-value",
        { start: { line: 0, character: 10 }, end: { line: 0, character: 20 } },
        { fieldKey: "favorite" },
      );

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([]);
    });

    it("returns empty array when fieldKey is missing from data", () => {
      const document = createMockDocument("status: invalid");
      const diagnostic = createMockDiagnostic("invalid-value", range, {});

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([]);
    });

    it("creates correct text edit with diagnostic range", () => {
      const document = createMockDocument("status: pendng");
      const diagnostic = createMockDiagnostic("invalid-value", range, {
        fieldKey: "status",
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions[0]?.edit?.changes?.[document.uri]).toEqual([
        {
          range,
          newText: "pending",
        },
      ]);
    });

    it("trims trailing whitespace from diagnostic range to preserve next line on replace", () => {
      const document = createMockDocument("status: comple\npriority: high\n");
      const rangeWithTrailing: Range = {
        start: { line: 0, character: 8 },
        end: { line: 1, character: 0 },
      };
      const diagnostic = createMockDiagnostic(
        "invalid-value",
        rangeWithTrailing,
        { fieldKey: "status" },
      );

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions[0]?.edit?.changes?.[document.uri]).toEqual([
        {
          range: {
            start: { line: 0, character: 8 },
            end: { line: 0, character: 14 },
          },
          newText: "complete",
        },
      ]);
    });
  });

  describe("unknown-field", () => {
    const range: Range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 14 },
    };

    it("suggests similar fields and remove action for misspelled field", () => {
      const document = createMockDocument("stauts: pending");
      const diagnostic = createMockDiagnostic("unknown-field", range, {
        fieldPath: ["stauts"],
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([
        expect.objectContaining({ title: "Replace with 'status'" }),
        expect.objectContaining({ title: "Remove invalid field 'stauts'" }),
      ]);
    });

    it("offers only remove action when no similar fields found", () => {
      const document = createMockDocument("zzzzz: hello");
      const diagnostic = createMockDiagnostic("unknown-field", range, {
        fieldPath: ["zzzzz"],
      });

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([
        expect.objectContaining({ title: "Remove invalid field 'zzzzz'" }),
      ]);
    });

    it("returns empty when fieldPath is missing", () => {
      const document = createMockDocument("foo: bar");
      const diagnostic = createMockDiagnostic("unknown-field", range, {});

      const actions = getActions(document, diagnostic, createMockContext());

      expect(actions).toEqual([]);
    });
  });
});

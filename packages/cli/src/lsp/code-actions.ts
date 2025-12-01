import type {
  CodeAction,
  CodeActionParams,
  Diagnostic,
  Position,
  Range,
  TextDocuments,
} from "vscode-languageserver/node";
import { CodeActionKind, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { FieldAttrDef, FieldDef } from "@binder/db";
import { findSimilar } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { DocumentCache } from "./document-cache.ts";
import { getAllowedFields, getDocumentContext } from "./lsp-utils.ts";

const getDefaultValue = (fieldDef: FieldDef, attrs?: FieldAttrDef): string => {
  if (attrs?.default !== undefined) {
    return String(attrs.default);
  }

  if (fieldDef.dataType === "option" && fieldDef.options?.[0]) {
    return fieldDef.options[0].key;
  }

  if (fieldDef.dataType === "boolean") return "false";
  if (fieldDef.dataType === "integer" || fieldDef.dataType === "decimal")
    return "0";
  if (fieldDef.dataType === "string" || fieldDef.dataType === "text")
    return '""';

  return "";
};

const findFieldLineRange = (
  document: TextDocument,
  diagnostic: Diagnostic,
): Range => {
  const line = diagnostic.range.start.line;
  const nextLineStart =
    line + 1 < document.lineCount ? line + 1 : document.lineCount;

  return {
    start: { line, character: 0 },
    end: { line: nextLineStart, character: 0 },
  };
};

const findInsertPosition = (document: TextDocument): Position => {
  const lastLine = document.lineCount - 1;
  const lastLineText = document.getText({
    start: { line: lastLine, character: 0 },
    end: { line: lastLine + 1, character: 0 },
  });

  if (lastLineText.trim() === "") {
    return { line: lastLine, character: 0 };
  }

  return { line: lastLine + 1, character: 0 };
};

const findFieldKeyRange = (
  document: TextDocument,
  diagnostic: Diagnostic,
  fieldKey: string,
): Range => {
  const line = diagnostic.range.start.line;
  const lineText = document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  });

  const keyIndex = lineText.indexOf(fieldKey);
  if (keyIndex === -1) return diagnostic.range;

  return {
    start: { line, character: keyIndex },
    end: { line, character: keyIndex + fieldKey.length },
  };
};

const createReplaceFieldAction = (
  diagnostic: Diagnostic,
  document: TextDocument,
  invalidFieldKey: string,
  suggestedFieldKey: string,
  isTopMatch: boolean,
): CodeAction => {
  const range = findFieldKeyRange(document, diagnostic, invalidFieldKey);
  const title = isTopMatch
    ? `Change spelling to '${suggestedFieldKey}'`
    : `Replace with '${suggestedFieldKey}'`;

  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [TextEdit.replace(range, suggestedFieldKey)],
      },
    },
  };
};

const createRemoveFieldAction = (
  diagnostic: Diagnostic,
  document: TextDocument,
  fieldKey: string,
): CodeAction => {
  const range = findFieldLineRange(document, diagnostic);

  return {
    title: `Remove invalid field '${fieldKey}'`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [TextEdit.del(range)],
      },
    },
  };
};

const createAddFieldAction = (
  diagnostic: Diagnostic,
  document: TextDocument,
  context: Awaited<ReturnType<typeof getDocumentContext>>,
): CodeAction | undefined => {
  if (!context) return undefined;

  const data = diagnostic.data as { fieldKey?: string } | undefined;
  if (!data?.fieldKey) return undefined;

  const fieldKey = data.fieldKey;
  const fieldDef = context.schema.fields[fieldKey as never];
  if (!fieldDef) return undefined;

  const attrs = context.typeDef?.fields_attrs?.[fieldKey as never];
  const defaultValue = getDefaultValue(fieldDef, attrs);
  const fieldText = `${fieldKey}: ${defaultValue}\n`;

  const insertPosition = findInsertPosition(document);

  return {
    title: `Add required field '${fieldKey}'`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [TextEdit.insert(insertPosition, fieldText)],
      },
    },
  };
};

export const handleCodeAction = async (
  params: CodeActionParams,
  lspDocuments: TextDocuments<TextDocument>,
  documentCache: DocumentCache,
  runtime: RuntimeContextWithDb,
  log: Logger,
): Promise<CodeAction[]> => {
  const document = lspDocuments.get(params.textDocument.uri);
  if (!document) {
    log.debug("Document not found for code action", {
      uri: params.textDocument.uri,
    });
    return [];
  }

  const context = await getDocumentContext(document, documentCache, runtime);
  if (!context) {
    log.debug("No document context for code action");
    return [];
  }

  const actions: CodeAction[] = [];
  const diagnostics = params.context.diagnostics;

  for (const diagnostic of diagnostics) {
    const code = diagnostic.code as string | undefined;

    if (code === "invalid-field") {
      const data = diagnostic.data as { fieldKey?: string } | undefined;
      if (!data?.fieldKey) continue;

      const allowedFields = getAllowedFields(context.typeDef, context.schema);
      const suggestions = findSimilar(allowedFields, data.fieldKey, {
        max: 3,
      });

      for (let i = 0; i < suggestions.length; i++) {
        actions.push(
          createReplaceFieldAction(
            diagnostic,
            document,
            data.fieldKey,
            suggestions[i]!.value,
            i === 0,
          ),
        );
      }

      actions.push(
        createRemoveFieldAction(diagnostic, document, data.fieldKey),
      );
    }

    if (code === "extra-field") {
      const data = diagnostic.data as { fieldKey?: string } | undefined;
      if (!data?.fieldKey) continue;

      actions.push(
        createRemoveFieldAction(diagnostic, document, data.fieldKey),
      );
    }

    if (code === "missing-required-field") {
      const action = createAddFieldAction(diagnostic, document, context);
      if (action) actions.push(action);
    }
  }

  log.debug("Generated code actions", {
    uri: params.textDocument.uri,
    count: actions.length,
  });

  return actions;
};

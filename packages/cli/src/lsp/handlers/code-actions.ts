import type {
  CodeAction,
  CodeActionParams,
  Diagnostic,
  Position,
  Range,
} from "vscode-languageserver/node";
import { CodeActionKind, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { FieldAttrDef, FieldDef, FieldPath } from "@binder/db";
import { findSimilar } from "@binder/utils";
import {
  type DocumentContext,
  getAllowedFields,
  type LspHandler,
} from "../document-context.ts";
import { getFieldDefForType } from "../cursor-context.ts";

type InvalidValueData = {
  fieldKey?: string;
  fieldPath?: FieldPath;
  value?: unknown;
};

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
  if (fieldDef.dataType === "plaintext" || fieldDef.dataType === "richtext")
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
): CodeAction => {
  const range = findFieldKeyRange(document, diagnostic, invalidFieldKey);
  const title = `Replace with '${suggestedFieldKey}'`;

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
  context: DocumentContext,
): CodeAction | undefined => {
  const data = diagnostic.data as { fieldKey?: string } | undefined;
  if (!data?.fieldKey) return undefined;

  const fieldKey = data.fieldKey;
  const fieldInfo = getFieldDefForType(
    fieldKey as never,
    context.typeDef,
    context.schema,
  );
  if (!fieldInfo) return undefined;

  const defaultValue = getDefaultValue(fieldInfo.def, fieldInfo.attrs);
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

const getFieldKeyFromData = (
  data: InvalidValueData | undefined,
): string | undefined => {
  if (data?.fieldKey) return data.fieldKey;
  if (data?.fieldPath && data.fieldPath.length > 0) return data.fieldPath[0];
  return undefined;
};

const trimTrailingRange = (document: TextDocument, range: Range): Range => {
  const text = document.getText(range);
  const trimmed = text.trimEnd();
  if (trimmed.length === text.length) return range;

  const lines = trimmed.split("\n");
  const endLine = range.start.line + lines.length - 1;
  const lastLine = lines[lines.length - 1]!;
  const endCharacter =
    lines.length === 1
      ? range.start.character + lastLine.length
      : lastLine.length;

  return {
    start: range.start,
    end: { line: endLine, character: endCharacter },
  };
};

const createReplaceValueAction = (
  diagnostic: Diagnostic,
  document: TextDocument,
  suggestedValue: string,
): CodeAction => {
  const title = `Replace with '${suggestedValue}'`;

  const range = trimTrailingRange(document, diagnostic.range);

  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [TextEdit.replace(range, suggestedValue)],
      },
    },
  };
};

const getInvalidValueActions = (
  diagnostic: Diagnostic,
  document: TextDocument,
  context: DocumentContext,
): CodeAction[] => {
  const data = diagnostic.data as InvalidValueData | undefined;
  const fieldKey = getFieldKeyFromData(data);
  if (!fieldKey) return [];

  const fieldInfo = getFieldDefForType(
    fieldKey,
    context.typeDef,
    context.schema,
  );
  if (!fieldInfo || fieldInfo.def.dataType !== "option") return [];

  const options = fieldInfo.def.options;
  if (!options || options.length === 0) return [];

  const currentValue = document.getText(diagnostic.range).trim();
  const optionKeys = options.map((o) => o.key);
  const suggestions = findSimilar(optionKeys, currentValue, { max: 3 });

  return suggestions.map((s) =>
    createReplaceValueAction(diagnostic, document, s.value),
  );
};

export const handleCodeAction: LspHandler<CodeActionParams, CodeAction[]> = (
  params,
  { document, context, runtime: { log } },
) => {
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

      for (const s of suggestions) {
        actions.push(
          createReplaceFieldAction(
            diagnostic,
            document,
            data.fieldKey,
            s.value,
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

    if (code === "invalid-value") {
      actions.push(...getInvalidValueActions(diagnostic, document, context));
    }
  }

  log.debug("Generated code actions", {
    uri: params.textDocument.uri,
    count: actions.length,
  });

  return actions;
};

import {
  SemanticTokensBuilder,
  type SemanticTokens,
  type SemanticTokensParams,
} from "vscode-languageserver/node";
import type { FieldDef } from "@binder/db";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  LspHandler,
  MarkdownDocumentContext,
} from "../document-context.ts";
import { unistPositionToLspRange } from "../cursor-context.ts";
import type { FieldSlotMapping } from "../../document/template.ts";

export const TOKEN_TYPES = [
  "property",
  "type",
  "number",
  "string",
  "enumMember",
] as const;
export const TOKEN_MODIFIERS = ["readonly"] as const;

type TokenType = (typeof TOKEN_TYPES)[number];

const tokenTypeIndex: Record<TokenType, number> = {
  property: 0,
  type: 1,
  number: 2,
  string: 3,
  enumMember: 4,
};

const getTokenType = (fieldDef: FieldDef): TokenType => {
  switch (fieldDef.dataType) {
    case "relation":
      return "type";
    case "boolean":
    case "integer":
    case "decimal":
      return "number";
    case "date":
    case "datetime":
    case "period":
      return "string";
    default:
      return "property";
  }
};

const pushMultiLineToken = (
  builder: SemanticTokensBuilder,
  document: TextDocument,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
  tokenType: number,
  tokenModifiers: number,
): void => {
  if (startLine === endLine) {
    builder.push(
      startLine,
      startChar,
      endChar - startChar,
      tokenType,
      tokenModifiers,
    );
    return;
  }

  const firstLineText = document.getText({
    start: { line: startLine, character: 0 },
    end: { line: startLine + 1, character: 0 },
  });
  const firstLineLength = firstLineText.replace(/\n$/, "").length;
  builder.push(
    startLine,
    startChar,
    firstLineLength - startChar,
    tokenType,
    tokenModifiers,
  );

  for (let line = startLine + 1; line < endLine; line++) {
    const lineText = document.getText({
      start: { line, character: 0 },
      end: { line: line + 1, character: 0 },
    });
    const lineLength = lineText.replace(/\n$/, "").length;
    if (lineLength > 0) {
      builder.push(line, 0, lineLength, tokenType, tokenModifiers);
    }
  }

  if (endChar > 0) {
    builder.push(endLine, 0, endChar, tokenType, tokenModifiers);
  }
};

const pushFieldToken = (
  builder: SemanticTokensBuilder,
  document: TextDocument,
  mapping: FieldSlotMapping,
  fieldDef: FieldDef,
): void => {
  const range = unistPositionToLspRange(mapping.position);
  const tokenType = tokenTypeIndex[getTokenType(fieldDef)];
  const tokenModifiers = 1; // readonly

  pushMultiLineToken(
    builder,
    document,
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
    tokenType,
    tokenModifiers,
  );
};

export const handleSemanticTokens: LspHandler<
  SemanticTokensParams,
  SemanticTokens
> = (_params, { document, context }) => {
  if (context.documentType !== "markdown") {
    return { data: [] };
  }

  const { fieldMappings, schema } = context as MarkdownDocumentContext;
  const builder = new SemanticTokensBuilder();

  for (const mapping of fieldMappings) {
    const fieldKey = mapping.path[0];
    if (!fieldKey) continue;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) continue;

    pushFieldToken(builder, document, mapping, fieldDef);
  }

  return builder.build();
};

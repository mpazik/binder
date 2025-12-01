import type {
  Position as LspPosition,
  Range as LspRange,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { isMap, isPair, isScalar, type LineCounter } from "yaml";
import type {
  EntitySchema,
  FieldAttrDef,
  FieldDef,
  FieldKey,
  NamespaceEditable,
  NodeType,
  TypeDef,
} from "@binder/db";
import { getAllFieldsForType, isFieldInSchema } from "@binder/db";
import { isErr } from "@binder/utils";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedDocument } from "../document/document.ts";
import type { NavigationItem } from "../document/navigation.ts";
import { namespaceFromSnapshotPath } from "../lib/snapshot.ts";
import {
  type ParsedYaml,
  type Position as YamlPosition,
} from "../document/yaml-cst.ts";
import type { DocumentCache } from "./document-cache.ts";

export type DocumentContext = {
  document: TextDocument;
  parsed: ParsedDocument;
  uri: string;
  namespace: NamespaceEditable;
  schema: EntitySchema;
  navigationItem: NavigationItem;
  typeDef?: TypeDef;
};

export const yamlRangeToLspRange = (
  range: [number, number, number],
  lineCounter: LineCounter,
): LspRange => {
  const startPos = offsetToPosition(range[0], lineCounter);
  const endPos = offsetToPosition(range[2], lineCounter);
  return {
    start: startPos,
    end: endPos,
  };
};

export const offsetToPosition = (
  offset: number,
  lineCounter: LineCounter,
): LspPosition => {
  let line = 0;
  let character = 0;

  for (let i = 0; i < lineCounter.lineStarts.length; i++) {
    const lineStart = lineCounter.lineStarts[i];
    const nextLineStart = lineCounter.lineStarts[i + 1];

    if (offset < lineStart) break;

    if (nextLineStart === undefined || offset < nextLineStart) {
      line = i;
      character = offset - lineStart;
      break;
    }
  }

  return { line, character };
};

export const positionToOffset = (
  position: LspPosition,
  lineCounter: LineCounter,
): number => {
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    const nextLineStart = lineCounter.lineStarts[i + 1];
    if (nextLineStart !== undefined) {
      offset = nextLineStart;
    }
  }
  return offset + position.character;
};

export const lspPositionToYamlPosition = (
  position: LspPosition,
): YamlPosition => {
  return {
    line: position.line,
    character: position.character,
  };
};

const extractTypeFromYaml = (
  parsed: ParsedYaml,
  schema: EntitySchema,
): TypeDef | undefined => {
  const { doc } = parsed;
  if (!doc.contents || !isMap(doc.contents)) return undefined;

  for (const item of doc.contents.items) {
    if (isPair(item) && isScalar(item.key)) {
      const key = String(item.key.value);
      if (key === "type" && isScalar(item.value)) {
        const typeName = String(item.value.value);
        return schema.types[typeName as never];
      }
    }
  }

  return undefined;
};

export const getDocumentContext = async (
  document: TextDocument,
  documentCache: DocumentCache,
  runtime: RuntimeContextWithDb,
): Promise<DocumentContext | undefined> => {
  const parsed = documentCache.getParsed(document);
  if (!parsed) return undefined;

  const filePath = document.uri.replace(/^file:\/\//, "");
  const namespace = namespaceFromSnapshotPath(filePath, runtime.config.paths);
  if (!namespace) return undefined;

  const schemaResult = await runtime.kg.getSchema(namespace);
  if (isErr(schemaResult)) return undefined;

  const schema = schemaResult.data;

  const typeDef =
    "doc" in parsed ? extractTypeFromYaml(parsed, schema) : undefined;

  return {
    document,
    parsed,
    uri: document.uri,
    namespace,
    schema,
    navigationItem: { path: filePath },
    typeDef,
  };
};

export const getAllowedFields = (
  typeDef: TypeDef | undefined,
  schema: EntitySchema,
): string[] => {
  if (!typeDef) return Object.keys(schema.fields);
  return getAllFieldsForType(typeDef.key as NodeType, schema);
};

export const getFieldDefForType = (
  fieldKey: FieldKey,
  typeDef: TypeDef | undefined,
  schema: EntitySchema,
):
  | {
      def: FieldDef;
      attrs?: FieldAttrDef;
    }
  | undefined => {
  if (!isFieldInSchema(fieldKey, schema)) return undefined;

  const def = schema.fields[fieldKey];
  if (!def) return undefined;

  const attrs = typeDef?.fields_attrs?.[fieldKey];
  return { def, attrs };
};

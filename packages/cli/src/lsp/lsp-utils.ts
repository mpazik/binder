import type {
  Position as LspPosition,
  Range as LspRange,
  TextDocumentIdentifier,
  TextDocuments,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { type LineCounter } from "yaml";
import type {
  EntitySchema,
  FieldAttrDef,
  FieldDef,
  FieldKey,
  NamespaceEditable,
  NodeType,
  TypeDef,
} from "@binder/db";
import {
  getAllFieldsForType,
  getTypeFieldAttrs,
  getTypeFieldKey,
  isFieldInSchema,
} from "@binder/db";
import { isErr } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedDocument } from "../document/document.ts";
import {
  type NavigationItem,
  findNavigationItemByPath,
} from "../document/navigation.ts";
import {
  getRelativeSnapshotPath,
  namespaceFromSnapshotPath,
} from "../lib/snapshot.ts";
import { getTypeFromFilters } from "../utils/query.ts";
import { type Position as YamlPosition } from "../document/yaml-cst.ts";
import type { DocumentCache } from "./document-cache.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";

type LspParams = { textDocument: TextDocumentIdentifier };

type LspHandlerDeps = {
  document: TextDocument;
  context: DocumentContext;
  runtime: RuntimeContextWithDb;
  log: Logger;
};

export type LspHandler<TParams extends LspParams, TResult> = (
  params: TParams,
  deps: LspHandlerDeps,
) => TResult | Promise<TResult>;

export type WithDocumentContextDeps = {
  lspDocuments: TextDocuments<TextDocument>;
  workspaceManager: WorkspaceManager;
  log: Logger;
};

export const withDocumentContext =
  <TParams extends LspParams, TResult>(
    requestName: string,
    deps: WithDocumentContextDeps,
    handler: LspHandler<TParams, TResult>,
  ) =>
  async (params: TParams): Promise<TResult | null> => {
    const { lspDocuments, workspaceManager, log } = deps;
    const uri = params.textDocument.uri;

    const workspace = workspaceManager.findWorkspaceForDocument(uri);
    if (workspace) {
      log.debug(`${requestName} request received`, { uri });
    } else {
      log.debug(`${requestName}: document not in any Binder workspace`, {
        uri,
      });
      return null;
    }

    const { runtime, documentCache } = workspace;

    const document = lspDocuments.get(uri);
    if (!document) {
      log.warn("Document not found", { uri });
      return null;
    }

    const context = await getDocumentContext(document, documentCache, runtime);
    if (!context) {
      log.debug("No document context", { uri });
      return null;
    }

    return handler(params, { document, context, runtime, log });
  };

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

const extractTypeFromNavigation = (
  navigationItem: NavigationItem,
  schema: EntitySchema,
): TypeDef | undefined => {
  const filters = navigationItem.query?.filters ?? navigationItem.where;
  if (!filters) return undefined;

  const entityType = getTypeFromFilters(filters);
  if (!entityType) return undefined;

  return schema.types[entityType as never];
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

  const navigationResult = await runtime.nav(namespace);
  if (isErr(navigationResult)) return undefined;

  const relativePath = getRelativeSnapshotPath(filePath, runtime.config.paths);
  const navigationItem = findNavigationItemByPath(
    navigationResult.data,
    relativePath,
  );
  if (navigationItem === undefined) return undefined;

  const typeDef = extractTypeFromNavigation(navigationItem, schema);

  return {
    document,
    parsed,
    uri: document.uri,
    namespace,
    schema,
    navigationItem,
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

const findFieldAttrsInType = (
  fieldKey: FieldKey,
  typeDef: TypeDef | undefined,
): FieldAttrDef | undefined => {
  if (!typeDef) return undefined;

  for (const fieldRef of typeDef.fields) {
    if (getTypeFieldKey(fieldRef) === fieldKey) {
      return getTypeFieldAttrs(fieldRef);
    }
  }

  return undefined;
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

  const attrs = findFieldAttrsInType(fieldKey, typeDef);
  return { def, attrs };
};

import { fileURLToPath } from "node:url";
import type {
  TextDocumentIdentifier,
  TextDocuments,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  EntitySchema,
  FieldKey,
  NamespaceEditable,
  RecordType,
  TypeDef,
} from "@binder/db";
import { getAllFieldsForType } from "@binder/db";
import { fail, isErr, ok, type ResultAsync } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedMarkdown } from "../document/markdown.ts";
import type { ParsedYaml } from "../document/yaml-cst.ts";
import { parseYamlDocument } from "../document/yaml-cst.ts";
import {
  findNavigationItemByPath,
  findView,
  type NavigationItem,
} from "../document/navigation.ts";
import {
  extractFieldMappings,
  type FieldSlotMapping,
} from "../document/view.ts";
import {
  getRelativeSnapshotPath,
  namespaceFromSnapshotPath,
} from "../lib/snapshot.ts";
import { getTypeFromFilters } from "../utils/query.ts";
import { extract, type ExtractedFileData } from "../document/extraction.ts";
import {
  getDocumentFileType,
  type DocumentType,
  type ParsedDocument,
  parseDocument,
} from "../document/document.ts";
import {
  computeEntityMappings,
  type EntityMappings,
} from "./entity-mapping.ts";
import { resolveWorkspace, type WorkspaceCtx } from "./workspace-manager.ts";
import type { EntityContextCache } from "./entity-context.ts";

type BaseDocumentContext = {
  document: TextDocument;
  uri: string;
  namespace: NamespaceEditable;
  schema: EntitySchema;
  navigationItem: NavigationItem;
  typeDef?: TypeDef;
  entityMappings: EntityMappings;
};

export type YamlDocumentContext = BaseDocumentContext & {
  documentType: "yaml";
  parsed: ParsedYaml;
};

export type FrontmatterContext = {
  parsed: ParsedYaml;
  lineOffset: number;
  preambleKeys: FieldKey[];
};

export type MarkdownDocumentContext = BaseDocumentContext & {
  documentType: "markdown";
  parsed: ParsedMarkdown;
  fieldMappings: FieldSlotMapping[];
  frontmatter?: FrontmatterContext;
};

export type DocumentContext = YamlDocumentContext | MarkdownDocumentContext;

type LspParams = { textDocument: TextDocumentIdentifier };

type LspHandlerCtx = {
  document: TextDocument;
  context: DocumentContext;
  runtime: RuntimeContextWithDb;
};

export type LspHandler<TParams extends LspParams, TResult> = (
  params: TParams,
  ctx: LspHandlerCtx,
) => TResult | Promise<TResult>;

export type WithDocumentCtx = WorkspaceCtx & {
  lspDocuments: TextDocuments<TextDocument>;
};

const expectedContextErrors = new Set(["navigation-not-found", "parse-failed"]);
const getContextErrorLevel = (key: string) =>
  expectedContextErrors.has(key) ? "debug" : "error";

export const withDocumentContext =
  <TParams extends LspParams, TResult>(
    ctx: WithDocumentCtx,
    requestName: string,
    handler: LspHandler<TParams, TResult>,
  ) =>
  async (params: TParams): Promise<TResult | null> => {
    const uri = params.textDocument.uri;

    const workspace = resolveWorkspace(ctx, uri, requestName);
    if (!workspace) return null;

    const { runtime, documentCache, entityContextCache } = workspace;
    const wsLog = runtime.log;

    wsLog.debug(`${requestName} request received`, { uri });

    const document = ctx.lspDocuments.get(uri);
    if (!document) {
      wsLog.warn("Document not found", { uri });
      return null;
    }

    const contextResult = await getDocumentContext(
      document,
      documentCache,
      entityContextCache,
      runtime,
    );
    if (isErr(contextResult)) {
      const { error } = contextResult;
      wsLog[getContextErrorLevel(error.key)](
        `${requestName}: ${error.message}`,
        { error },
      );
      return null;
    }

    return handler(params, {
      document,
      context: contextResult.data,
      runtime,
    });
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

export type DocumentCache = {
  getParsed: (document: TextDocument) => ParsedDocument | undefined;
  invalidate: (uri: string) => void;
  getStats: () => { size: number; hits: number; misses: number };
};

export const createDocumentCache = (log: Logger): DocumentCache => {
  const cache = new Map<
    string,
    {
      version: number;
      parsed: ParsedDocument;
    }
  >();
  let hits = 0;
  let misses = 0;

  const getParsed = (document: TextDocument): ParsedDocument | undefined => {
    const uri = document.uri;
    const version = document.version;
    const key = `${uri}:${version}`;

    const cached = cache.get(key);
    if (cached) {
      hits++;
      return cached.parsed;
    }

    const filePath = fileURLToPath(uri);
    const type = getDocumentFileType(filePath);

    if (!type) {
      log.debug("Document type not supported for caching", { uri, filePath });
      return undefined;
    }

    misses++;

    const text = document.getText();
    const parsed = parseDocument(text, type);

    cache.set(key, { version, parsed });
    return parsed;
  };

  const invalidate = (uri: string): void => {
    let removed = 0;
    for (const key of cache.keys()) {
      if (key.startsWith(`${uri}:`)) {
        cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      log.debug("Document cache invalidated", {
        uri,
        entriesRemoved: removed,
        cacheSize: cache.size,
      });
    }
  };

  const getStats = () => ({
    size: cache.size,
    hits,
    misses,
  });

  return {
    getParsed,
    invalidate,
    getStats,
  };
};

const buildFrontmatterContext = (
  root: ParsedMarkdown["root"],
  preamble: string[] | undefined,
): FrontmatterContext | undefined => {
  if (!preamble || preamble.length === 0) return undefined;

  const yamlNode = root.children.find((child) => child.type === "yaml");
  if (
    !yamlNode ||
    !("value" in yamlNode) ||
    typeof yamlNode.value !== "string" ||
    !yamlNode.position
  )
    return undefined;

  const parsed = parseYamlDocument(yamlNode.value);
  const lineOffset = yamlNode.position.start.line;

  return { parsed, lineOffset, preambleKeys: preamble };
};

// When the strict YAML parser fails (e.g. mid-edit, partial/invalid syntax),
// fall back to empty entity data so the tolerant CST path can still serve
// completions, hover, and diagnostics.
const fallbackExtractedData = (
  navigationItem: NavigationItem,
  documentType: DocumentType,
): ExtractedFileData => {
  if (navigationItem.query) {
    return { kind: "list", entities: [], query: navigationItem.query };
  }
  if (documentType === "markdown") {
    return {
      kind: "document",
      entity: {},
      projections: [],
      includes: undefined,
    };
  }
  return { kind: "single", entity: {} };
};

export const getDocumentContext = async (
  document: TextDocument,
  documentCache: DocumentCache,
  entityContextCache: EntityContextCache,
  runtime: RuntimeContextWithDb,
): ResultAsync<DocumentContext> => {
  const uri = document.uri;
  const parsed = documentCache.getParsed(document);
  if (!parsed)
    return fail("parse-failed", "Failed to parse document", { data: { uri } });

  const filePath = fileURLToPath(uri);
  const namespace = namespaceFromSnapshotPath(filePath, runtime.config.paths);
  if (!namespace)
    return fail("namespace-not-found", "Could not determine namespace", {
      data: { uri },
    });

  const schemaResult = await runtime.kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;

  const schema = schemaResult.data;

  const navigationResult = await runtime.nav(namespace);
  if (isErr(navigationResult)) return navigationResult;

  const relativePath = getRelativeSnapshotPath(filePath, runtime.config.paths);
  const navigationItem = findNavigationItemByPath(
    navigationResult.data,
    relativePath,
  );
  if (navigationItem === undefined)
    return fail("navigation-not-found", "No navigation item for path", {
      data: { uri, relativePath },
    });

  const typeDef = extractTypeFromNavigation(navigationItem, schema);

  const entityContextResult = await entityContextCache.get(
    schema,
    uri,
    navigationItem,
    document.getText(),
  );
  if (isErr(entityContextResult)) return entityContextResult;

  const viewsResult = await runtime.views();
  if (isErr(viewsResult)) return viewsResult;

  const documentType = getDocumentFileType(filePath);
  if (!documentType)
    return fail("unknown-document-type", "Unknown document type", {
      data: { uri },
    });

  const baseEntity = entityContextResult.data.entities[0] ?? {};
  const extractResult = extract(
    schema,
    navigationItem,
    document.getText(),
    relativePath,
    viewsResult.data,
    baseEntity,
  );

  let extracted: ExtractedFileData;
  if (isErr(extractResult)) {
    // Extraction fails when the document contains partial or invalid YAML —
    // common during active editing. Fall back to empty entity data so LSP
    // features keep working via the tolerant YAML CST parser.
    runtime.log.debug(
      "Extraction failed; using empty fallback for LSP context",
      {
        uri,
        error: extractResult.error.message,
      },
    );
    extracted = fallbackExtractedData(navigationItem, documentType);
  } else {
    extracted = extractResult.data;
  }

  const entityMappings = computeEntityMappings(
    schema,
    extracted,
    entityContextResult.data,
  );

  const base = {
    document,
    uri,
    namespace,
    schema,
    navigationItem,
    typeDef,
    entityMappings,
  };

  if (documentType === "markdown") {
    const parsedMarkdown = parsed as ParsedMarkdown;
    const viewEntity = navigationItem.view
      ? findView(viewsResult.data, navigationItem.view)
      : undefined;

    const fieldMappings = viewEntity
      ? extractFieldMappings(viewEntity.viewAst, parsedMarkdown.root)
      : [];

    const frontmatter = buildFrontmatterContext(
      parsedMarkdown.root,
      viewEntity?.preamble,
    );

    return ok({
      ...base,
      documentType: "markdown",
      parsed: parsedMarkdown,
      fieldMappings,
      frontmatter,
    });
  }

  return ok({
    ...base,
    documentType: "yaml",
    parsed: parsed as ParsedYaml,
  });
};

export const getAllowedFields = (
  typeDef: TypeDef | undefined,
  schema: EntitySchema,
): string[] => {
  if (!typeDef) return Object.keys(schema.fields);
  return getAllFieldsForType(typeDef.key as RecordType, schema);
};

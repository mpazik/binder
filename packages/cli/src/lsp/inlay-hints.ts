import type {
  InlayHint,
  InlayHintParams,
  TextDocuments,
} from "vscode-languageserver/node";
import { InlayHintKind } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { isMap, isPair, isScalar, isSeq, type YAMLMap } from "yaml";
import type { NodeFieldDefinition, NodeRef } from "@binder/db";
import { isErr } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedYaml } from "../document/yaml-cst.ts";
import type { DocumentCache } from "./document-cache.ts";
import { getDocumentContext, offsetToPosition } from "./lsp-utils.ts";

type RelationValue = {
  value: string;
  offset: number;
  endOffset: number;
};

const collectRelationValuesFromMap = (
  mapNode: YAMLMap.Parsed,
  schema: { fields: Record<string, NodeFieldDefinition> },
  values: RelationValue[],
): void => {
  for (const item of mapNode.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;

    const fieldKey = String(item.key.value);
    const fieldDef = schema.fields[fieldKey as never];

    if (!fieldDef || fieldDef.dataType !== "relation") continue;

    if (isScalar(item.value) && item.value.value && item.value.range) {
      values.push({
        value: String(item.value.value),
        offset: item.value.range[0],
        endOffset: item.value.range[1],
      });
    } else if (isSeq(item.value)) {
      for (const seqItem of item.value.items) {
        if (isScalar(seqItem) && seqItem.value && seqItem.range) {
          values.push({
            value: String(seqItem.value),
            offset: seqItem.range[0],
            endOffset: seqItem.range[1],
          });
        }
      }
    }
  }
};

const collectRelationValues = (
  parsed: ParsedYaml,
  schema: { fields: Record<string, NodeFieldDefinition> },
): RelationValue[] => {
  const values: RelationValue[] = [];
  const doc = parsed.doc;

  if (!doc.contents || !isMap(doc.contents)) return values;

  const contents = doc.contents as YAMLMap.Parsed;

  // Check if this is a list format with "items:" wrapper
  const itemsField = contents.items.find(
    (item) => isPair(item) && isScalar(item.key) && item.key.value === "items",
  );

  if (itemsField && isPair(itemsField) && isSeq(itemsField.value)) {
    // Handle list format: items: [...]
    for (const listItem of itemsField.value.items) {
      if (isMap(listItem)) {
        collectRelationValuesFromMap(
          listItem as YAMLMap.Parsed,
          schema,
          values,
        );
      }
    }
  } else {
    // Handle single entity format
    collectRelationValuesFromMap(contents, schema, values);
  }

  return values;
};

const resolveEntityTitle = async (
  ref: string,
  runtime: RuntimeContextWithDb,
): Promise<string | undefined> => {
  const result = await runtime.kg.fetchNode(ref as NodeRef);
  if (isErr(result)) return undefined;

  const entity = result.data;
  return (entity.title || entity.name) as string | undefined;
};

export const handleInlayHints = async (
  params: InlayHintParams,
  lspDocuments: TextDocuments<TextDocument>,
  documentCache: DocumentCache,
  runtime: RuntimeContextWithDb,
  log: Logger,
): Promise<InlayHint[]> => {
  const document = lspDocuments.get(params.textDocument.uri);
  if (!document) {
    log.debug("Document not found for inlay hints", {
      uri: params.textDocument.uri,
    });
    return [];
  }

  const context = await getDocumentContext(document, documentCache, runtime);
  if (!context) {
    log.debug("No document context for inlay hints");
    return [];
  }

  const parsed = context.parsed as ParsedYaml;
  if (!parsed.doc || !parsed.lineCounter) {
    log.debug("Not a YAML document");
    return [];
  }

  const relationValues = collectRelationValues(parsed, context.schema);
  const hints: InlayHint[] = [];

  for (const relation of relationValues) {
    const title = await resolveEntityTitle(relation.value, runtime);
    if (!title || title === relation.value) continue;

    const position = offsetToPosition(relation.endOffset, parsed.lineCounter);

    hints.push({
      position,
      label: title,
      kind: InlayHintKind.Type,
      paddingLeft: true,
    });
  }

  return hints;
};

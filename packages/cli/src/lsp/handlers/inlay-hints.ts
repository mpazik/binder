import type { InlayHint, InlayHintParams } from "vscode-languageserver/node";
import { InlayHintKind } from "vscode-languageserver/node";
import { isMap, isPair, isScalar, isSeq, type YAMLMap } from "yaml";
import type { EntitySchema, RecordRef } from "@binder/db";
import { isErr } from "@binder/utils";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import type { ParsedYaml } from "../../document/yaml-cst.ts";
import type {
  LspHandler,
  MarkdownDocumentContext,
} from "../document-context.ts";

import { offsetToPosition } from "../cursor-context.ts";

type RelationValue = {
  value: string;
  offset: number;
  endOffset: number;
};

const collectRelationValuesFromMap = (
  mapNode: YAMLMap.Parsed,
  schema: EntitySchema,
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
  schema: EntitySchema,
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
  const result = await runtime.kg.fetchEntity(ref as RecordRef);
  if (isErr(result)) return undefined;

  const entity = result.data;
  return (entity.title || entity.name) as string | undefined;
};

const buildHint = (
  relation: RelationValue,
  title: string,
  lineCounter: ParsedYaml["lineCounter"],
  lineOffset = 0,
): InlayHint => {
  const position = offsetToPosition(relation.endOffset, lineCounter);
  return {
    position: {
      line: position.line + lineOffset,
      character: position.character,
    },
    label: title,
    kind: InlayHintKind.Type,
    paddingLeft: true,
  };
};

const collectFrontmatterHints = async (
  context: MarkdownDocumentContext,
  runtime: RuntimeContextWithDb,
): Promise<InlayHint[]> => {
  const { frontmatter } = context;
  if (!frontmatter) return [];

  const relationValues = collectRelationValues(
    frontmatter.parsed,
    context.schema,
  );

  const hints: InlayHint[] = [];
  for (const relation of relationValues) {
    const title = await resolveEntityTitle(relation.value, runtime);
    if (!title || title === relation.value) continue;
    hints.push(
      buildHint(
        relation,
        title,
        frontmatter.parsed.lineCounter,
        frontmatter.lineOffset,
      ),
    );
  }
  return hints;
};

export const handleInlayHints: LspHandler<
  InlayHintParams,
  InlayHint[]
> = async (_params, { context, runtime }) => {
  if (context.documentType === "markdown") {
    return collectFrontmatterHints(context, runtime);
  }

  const parsed = context.parsed as ParsedYaml;
  if (!parsed.doc || !parsed.lineCounter) return [];

  const relationValues = collectRelationValues(parsed, context.schema);
  const hints: InlayHint[] = [];

  for (const relation of relationValues) {
    const title = await resolveEntityTitle(relation.value, runtime);
    if (!title || title === relation.value) continue;
    hints.push(buildHint(relation, title, parsed.lineCounter));
  }

  return hints;
};

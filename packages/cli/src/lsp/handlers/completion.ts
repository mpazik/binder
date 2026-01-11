import type {
  CompletionItem,
  CompletionParams,
} from "vscode-languageserver/node";
import { CompletionItemKind } from "vscode-languageserver/node";
import { isMap } from "yaml";
import type {
  EntitySchema,
  FieldAttrDef,
  FieldDef,
  NamespaceEditable,
  NodeFieldDef,
  NodeType,
  TypeDef,
} from "@binder/db";
import { isErr } from "@binder/utils";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import { getFieldKeys, getParentMap } from "../../document/yaml-cst.ts";
import {
  getAllowedFields,
  type DocumentContext,
  type LspHandler,
} from "../document-context.ts";
import {
  getCursorContext,
  getSchemaFieldPath,
  getSiblingValues,
  type CursorContext,
} from "../cursor-context.ts";

const createFieldNameCompletions = (
  allowedFields: string[],
  existingFields: string[],
  schema: EntitySchema,
  typeDef: TypeDef | undefined,
): CompletionItem[] => {
  const availableFields = allowedFields.filter(
    (field) => !existingFields.includes(field),
  );

  const typeSpecificFields = new Set(typeDef?.fields ?? []);

  return availableFields.map((fieldKey) => {
    const fieldDef = schema.fields[fieldKey as never];
    const isTypeSpecific = typeSpecificFields.has(fieldKey);

    return {
      label: fieldKey,
      kind: CompletionItemKind.Property,
      detail: fieldDef?.dataType,
      documentation: fieldDef?.description,
      sortText: isTypeSpecific ? `0_${fieldKey}` : `1_${fieldKey}`,
    };
  });
};

const createOptionCompletions = (fieldDef: NodeFieldDef): CompletionItem[] => {
  if (fieldDef.dataType !== "option" || !fieldDef.options) return [];

  return fieldDef.options.map((opt) => ({
    label: opt.key,
    kind: CompletionItemKind.EnumMember,
    documentation: opt.name,
  }));
};

const createBooleanCompletions = (): CompletionItem[] => [
  { label: "true", kind: CompletionItemKind.Constant },
  { label: "false", kind: CompletionItemKind.Constant },
];

const createRelationCompletions = async (
  { kg, log }: RuntimeContextWithDb,
  namespace: NamespaceEditable,
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
  excludeValues: string[] = [],
): Promise<CompletionItem[]> => {
  if (fieldDef.dataType !== "relation") return [];

  const range = fieldDef.range ?? attrs?.only;
  if (!range || range.length === 0) {
    return [
      {
        label: "(no range defined)",
        kind: CompletionItemKind.Text,
        detail: "Relation missing 'range' or 'only'",
        documentation:
          "This relation field does not have any target types defined. Add a 'range' property to the schema or an 'only' constraint to the type definition.",
        insertText: "# Fix schema: missing relation range",
      },
    ];
  }

  const completions: CompletionItem[] = [];

  for (const targetType of range) {
    const searchResult = await kg.search(
      {
        filters: { type: targetType as NodeType },
        pagination: { limit: 50 },
      },
      namespace,
    );

    if (isErr(searchResult)) {
      log.debug("Failed to search entities for completion", {
        error: searchResult.error,
      });
      continue;
    }

    for (const entity of searchResult.data.items) {
      const label = (entity.title ||
        entity.name ||
        entity.key ||
        entity.uid) as string;
      const insertText = (entity.key || entity.uid) as string;

      if (excludeValues.includes(insertText)) continue;

      completions.push({
        label,
        kind: CompletionItemKind.Reference,
        detail: targetType,
        insertText,
      });
    }
  }

  return completions;
};

const createValueCompletions = async (
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
  namespace: NamespaceEditable,
  runtime: RuntimeContextWithDb,
  excludeValues: string[] = [],
): Promise<CompletionItem[]> => {
  if (fieldDef.dataType === "option") {
    return createOptionCompletions(fieldDef as FieldDef<"option">);
  }

  if (fieldDef.dataType === "boolean") {
    return createBooleanCompletions();
  }

  if (fieldDef.dataType === "relation") {
    return createRelationCompletions(
      runtime,
      namespace,
      fieldDef,
      attrs,
      excludeValues,
    );
  }

  return [];
};

const handleYamlFieldKeyCompletion = (
  context: DocumentContext,
  cursorContext: CursorContext,
): CompletionItem[] => {
  if (
    cursorContext.documentType !== "yaml" ||
    cursorContext.type !== "field-key"
  )
    return [];

  const { parsed } = context as { parsed: { doc: { contents: unknown } } };
  if (!parsed.doc.contents) return [];

  const parentMap = getParentMap([parsed.doc.contents as never]);
  if (!parentMap || !isMap(parentMap)) return [];

  const existingFields = getFieldKeys(parentMap);
  const allowedFields = getAllowedFields(context.typeDef, context.schema);

  return createFieldNameCompletions(
    allowedFields,
    existingFields,
    context.schema,
    context.typeDef,
  );
};

const handleFieldValueCompletion = async (
  context: DocumentContext,
  cursorContext: CursorContext,
  runtime: RuntimeContextWithDb,
): Promise<CompletionItem[]> => {
  if (cursorContext.type !== "field-value") return [];

  const { fieldDef, fieldAttrs, fieldPath, itemIndex, entity } = cursorContext;

  const excludeValues =
    itemIndex !== undefined
      ? getSiblingValues(
          context,
          getSchemaFieldPath(fieldPath),
          entity.entityIndex,
        )
      : [];

  return createValueCompletions(
    fieldDef,
    fieldAttrs,
    context.namespace,
    runtime,
    excludeValues,
  );
};

export const handleCompletion: LspHandler<
  CompletionParams,
  CompletionItem[]
> = async (params, { context, runtime }) => {
  const { log } = runtime;
  log.debug("COMPLETION");

  const cursorContext = getCursorContext(context, params.position);

  if (cursorContext.type === "none") {
    log.debug("No cursor context at position");
    return [];
  }

  if (
    cursorContext.documentType === "yaml" &&
    cursorContext.type === "field-key"
  ) {
    return handleYamlFieldKeyCompletion(context, cursorContext);
  }

  if (cursorContext.type === "field-value") {
    return handleFieldValueCompletion(context, cursorContext, runtime);
  }

  log.debug("Unsupported completion context", {
    documentType: cursorContext.documentType,
    type: cursorContext.type,
  });
  return [];
};

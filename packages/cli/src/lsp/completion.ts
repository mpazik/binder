import type {
  CompletionItem,
  CompletionParams,
} from "vscode-languageserver/node";
import { CompletionItemKind } from "vscode-languageserver/node";
import { isMap, isPair, isScalar, isSeq } from "yaml";
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
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedYaml, YamlPath } from "../document/yaml-cst.ts";
import {
  getFieldKeys,
  getParentMap,
  getPositionContext,
} from "../document/yaml-cst.ts";
import {
  getAllowedFields,
  getFieldDefForType,
  type LspHandler,
  lspPositionToYamlPosition,
} from "./lsp-utils.ts";

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

const createBooleanCompletions = (): CompletionItem[] => {
  return [
    { label: "true", kind: CompletionItemKind.Constant },
    { label: "false", kind: CompletionItemKind.Constant },
  ];
};

const createRelationCompletions = async (
  { kg, log }: RuntimeContextWithDb,
  namespace: NamespaceEditable,
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
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

const getParentFieldKey = (path: YamlPath): string | undefined => {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (isPair(node) && isScalar(node.key)) {
      return String(node.key.value);
    }
  }
  return undefined;
};

const getExistingSeqItemKeys = (seqNode: unknown): string[] => {
  if (!seqNode || isPair(seqNode) || !isSeq(seqNode)) return [];

  const keys: string[] = [];
  for (const item of seqNode.items) {
    if (isScalar(item)) {
      keys.push(String(item.value));
    } else if (isMap(item) && item.items.length > 0) {
      const firstPair = item.items[0];
      if (isPair(firstPair) && isScalar(firstPair.key)) {
        keys.push(String(firstPair.key.value));
      }
    }
  }
  return keys;
};

const createSeqItemRelationCompletions = async (
  runtime: RuntimeContextWithDb,
  namespace: NamespaceEditable,
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
  existingKeys: string[],
): Promise<CompletionItem[]> => {
  const completions = await createRelationCompletions(
    runtime,
    namespace,
    fieldDef,
    attrs,
  );

  return completions.filter(
    (item) => !existingKeys.includes(item.insertText ?? item.label),
  );
};

const createValueCompletions = async (
  fieldKey: string,
  schema: EntitySchema,
  typeDef: TypeDef | undefined,
  namespace: NamespaceEditable,
  runtime: RuntimeContextWithDb,
): Promise<CompletionItem[]> => {
  const fieldInfo = getFieldDefForType(fieldKey, typeDef, schema);
  if (!fieldInfo) return [];

  const { def: fieldDef, attrs } = fieldInfo;

  if (fieldDef.dataType === "option") {
    return createOptionCompletions(fieldDef as FieldDef<"option">);
  }

  if (fieldDef.dataType === "boolean") {
    return createBooleanCompletions();
  }

  if (fieldDef.dataType === "relation") {
    return createRelationCompletions(runtime, namespace, fieldDef, attrs);
  }

  return [];
};

export const handleCompletion: LspHandler<
  CompletionParams,
  CompletionItem[]
> = async (params, { document, context, runtime }) => {
  const { log } = runtime;
  log.debug("COMPLETION");
  const parsed = context.parsed as ParsedYaml;
  if (!parsed.doc || !parsed.lineCounter) {
    log.debug("Not a YAML document");
    return [];
  }

  const yamlPosition = lspPositionToYamlPosition(params.position);
  const yamlContext = getPositionContext(document.getText(), yamlPosition);

  if (!yamlContext) {
    log.debug("No YAML context at position");
    return [];
  }

  if (yamlContext.type === "key" || yamlContext.type === "unknown") {
    const parentMap = getParentMap(yamlContext.path);
    if (!parentMap || !isMap(parentMap)) {
      log.debug("No parent map found for field completion");
      return [];
    }

    const existingFields = getFieldKeys(parentMap);
    const allowedFields = getAllowedFields(context.typeDef, context.schema);

    return createFieldNameCompletions(
      allowedFields,
      existingFields,
      context.schema,
      context.typeDef,
    );
  }

  if (yamlContext.type === "value" && yamlContext.fieldKey) {
    return createValueCompletions(
      yamlContext.fieldKey,
      context.schema,
      context.typeDef,
      context.namespace,
      runtime,
    );
  }

  if (yamlContext.type === "seq-item") {
    const parentFieldKey = getParentFieldKey(yamlContext.path);
    if (!parentFieldKey) return [];

    const fieldInfo = getFieldDefForType(
      parentFieldKey,
      context.typeDef,
      context.schema,
    );
    if (!fieldInfo || fieldInfo.def.dataType !== "relation") return [];

    const existingKeys = getExistingSeqItemKeys(yamlContext.parent);

    return createSeqItemRelationCompletions(
      runtime,
      context.namespace,
      fieldInfo.def,
      fieldInfo.attrs,
      existingKeys,
    );
  }

  log.debug("Unsupported completion context", { type: yamlContext.type });
  return [];
};

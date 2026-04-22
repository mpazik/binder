import {
  CompletionItemKind,
  type CompletionItem,
  type CompletionParams,
} from "vscode-languageserver/node";
import { isMap, type Pair, type ParsedNode } from "yaml";
import {
  getOptionDefsForFieldRef,
  IDENTIFIER_FORMAT_PATTERN,
  type FieldAttrDef,
  type FieldDef,
  type KnowledgeGraph,
  type NamespaceEditable,
  type RecordFieldDef,
  type RecordType,
} from "@binder/repo";
import { isErr } from "@binder/utils";
import {
  findYamlContext,
  getFieldKeys,
  getParentMap,
} from "../../document/yaml-cst.ts";
import {
  getAllowedFields,
  type DocumentContext,
  type FrontmatterContext,
  type LspHandler,
} from "../document-context.ts";
import {
  getCursorContext,
  getSchemaFieldPath,
  getSiblingValues,
  positionToOffset,
  type CursorContext,
  type MarkdownFieldValueContext,
  type MarkdownFrontmatterFieldValueContext,
  type YamlFieldValueContext,
} from "../cursor-context.ts";

export type FieldKeyCompletionInput = {
  kind: "field-key";
  context: DocumentContext;
  frontmatter?: FrontmatterContext;
  parentMap?: ParsedNode | Pair;
  keyPrefix?: string;
};

export type FieldValueCompletionInput = {
  kind: "field-value";
  cursorContext:
    | YamlFieldValueContext
    | MarkdownFieldValueContext
    | MarkdownFrontmatterFieldValueContext;
  context: DocumentContext;
  excludeValues: string[];
};

export type CompletionInput =
  | FieldKeyCompletionInput
  | FieldValueCompletionInput;

const createOptionCompletions = (
  fieldDef: RecordFieldDef,
  attrs?: FieldAttrDef,
): CompletionItem[] => {
  if (fieldDef.dataType !== "option") return [];

  const options = getOptionDefsForFieldRef(fieldDef, attrs);
  if (!options || options.length === 0) return [];

  return options.map((opt) => ({
    label: opt.key,
    kind: CompletionItemKind.EnumMember,
    documentation: opt.name,
  }));
};

const BOOLEAN_COMPLETIONS: CompletionItem[] = [
  { label: "true", kind: CompletionItemKind.Constant },
  { label: "false", kind: CompletionItemKind.Constant },
];

const createRelationCompletions = async (
  kg: KnowledgeGraph,
  namespace: NamespaceEditable,
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
  excludeValues: string[],
): Promise<CompletionItem[]> => {
  if (fieldDef.dataType !== "relation") return [];

  const range = attrs?.only ?? fieldDef.range;
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
        filters: { type: targetType as RecordType },
        pagination: { limit: 50 },
      },
      namespace,
    );

    if (isErr(searchResult)) continue;

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

const getDocumentYamlContents = (
  context: DocumentContext,
  frontmatter?: FrontmatterContext,
) => {
  if (frontmatter) return frontmatter.parsed.doc.contents;
  if (context.documentType === "yaml") return context.parsed.doc.contents;
  return undefined;
};

const getDocumentLinePrefix = (
  context: DocumentContext,
  position: CompletionParams["position"],
): string => {
  const line = context.document.getText().split(/\r?\n/u)[position.line] ?? "";
  return line.slice(0, position.character);
};

const isPositionInFrontmatter = (
  frontmatter: FrontmatterContext,
  position: CompletionParams["position"],
): boolean => {
  const localLine = position.line - frontmatter.lineOffset;
  if (localLine < 0) return false;
  return localLine < frontmatter.parsed.lineCounter.lineStarts.length;
};

const buildFieldKeyInputAtPosition = (
  context: DocumentContext,
  position: CompletionParams["position"],
  opts?: {
    frontmatter?: FrontmatterContext;
    requireKeyIntent?: boolean;
  },
): FieldKeyCompletionInput | undefined => {
  const frontmatter = opts?.frontmatter;

  if (context.documentType !== "yaml" && !frontmatter) return undefined;

  const contents = getDocumentYamlContents(context, frontmatter);
  if (!contents) return undefined;

  const lineCounter = frontmatter
    ? frontmatter.parsed.lineCounter
    : context.documentType === "yaml"
      ? context.parsed.lineCounter
      : undefined;
  if (!lineCounter) return undefined;

  const localPosition = frontmatter
    ? {
        line: position.line - frontmatter.lineOffset,
        character: position.character,
      }
    : position;
  if (localPosition.line < 0) return undefined;

  const offset = positionToOffset(localPosition, lineCounter);
  const yamlContext = findYamlContext(contents, offset);

  const parentMapFromPath = getParentMap(yamlContext.path);
  const parentMap =
    parentMapFromPath && isMap(parentMapFromPath)
      ? parentMapFromPath
      : isMap(contents)
        ? contents
        : undefined;
  if (!parentMap) return undefined;

  const linePrefix = getDocumentLinePrefix(context, position);
  const trimmedPrefix = linePrefix.trimStart();

  const isIdentifierPrefix =
    trimmedPrefix === "" || IDENTIFIER_FORMAT_PATTERN.test(trimmedPrefix);
  const isKeyIntent =
    !trimmedPrefix.includes(":") &&
    !trimmedPrefix.startsWith("-") &&
    isIdentifierPrefix &&
    (trimmedPrefix === "" ||
      yamlContext.type === "key" ||
      yamlContext.type === "unknown");

  if (opts?.requireKeyIntent && !isKeyIntent) return undefined;

  const keyPrefix =
    trimmedPrefix === "" ? "" : isIdentifierPrefix ? trimmedPrefix : undefined;

  if (opts?.requireKeyIntent && keyPrefix === undefined) return undefined;

  return {
    kind: "field-key",
    context,
    frontmatter,
    parentMap,
    keyPrefix,
  };
};

const getFallbackFieldKeyInput = (
  context: DocumentContext,
  position: CompletionParams["position"],
): FieldKeyCompletionInput | undefined => {
  if (context.documentType === "yaml") {
    return buildFieldKeyInputAtPosition(context, position, {
      requireKeyIntent: true,
    });
  }

  if (!context.frontmatter) return undefined;
  if (!isPositionInFrontmatter(context.frontmatter, position)) return undefined;

  return buildFieldKeyInputAtPosition(context, position, {
    frontmatter: context.frontmatter,
    requireKeyIntent: true,
  });
};

const getFieldKeyCompletions = (
  input: FieldKeyCompletionInput,
): CompletionItem[] => {
  const { context, frontmatter, keyPrefix } = input;

  if (context.documentType !== "yaml" && !frontmatter) return [];

  const contents = getDocumentYamlContents(context, frontmatter);
  if (!contents) return [];

  const parentMap = input.parentMap ?? getParentMap([contents]);
  if (!parentMap || !isMap(parentMap)) return [];

  const existingFields = getFieldKeys(parentMap);
  const allowedFields = frontmatter
    ? frontmatter.preambleKeys.filter((key) => key in context.schema.fields)
    : getAllowedFields(context.typeDef, context.schema);

  const normalizedPrefix = keyPrefix?.toLowerCase();
  const availableFields = allowedFields.filter((field) => {
    if (existingFields.includes(field)) return false;
    if (normalizedPrefix === undefined || normalizedPrefix === "") return true;
    return field.toLowerCase().startsWith(normalizedPrefix);
  });

  const typeSpecificFields = new Set(context.typeDef?.fields ?? []);

  return availableFields.map((fieldKey) => {
    const fieldDef = context.schema.fields[fieldKey];
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

export const getCompletionItems = async (
  input: CompletionInput,
  kg: KnowledgeGraph,
): Promise<CompletionItem[]> => {
  if (input.kind === "field-key") return getFieldKeyCompletions(input);

  const { cursorContext, context, excludeValues } = input;
  const { fieldDef, fieldAttrs } = cursorContext;

  switch (fieldDef.dataType) {
    case "option":
      return createOptionCompletions(
        fieldDef as FieldDef<"option">,
        fieldAttrs,
      );
    case "boolean":
      return BOOLEAN_COMPLETIONS;
    case "relation":
      return createRelationCompletions(
        kg,
        context.namespace,
        fieldDef,
        fieldAttrs,
        excludeValues,
      );
    default:
      return [];
  }
};

const buildCompletionInput = (
  cursorContext: CursorContext,
  context: DocumentContext,
  position: CompletionParams["position"],
): CompletionInput | undefined => {
  if (
    cursorContext.documentType === "yaml" &&
    cursorContext.type === "field-key"
  ) {
    return buildFieldKeyInputAtPosition(context, position);
  }

  if (cursorContext.type === "frontmatter-field-key") {
    return buildFieldKeyInputAtPosition(context, position, {
      frontmatter: cursorContext.frontmatter,
    });
  }

  if (
    cursorContext.type === "field-value" ||
    cursorContext.type === "frontmatter-field-value"
  ) {
    const { fieldPath, itemIndex, entity } = cursorContext;
    const frontmatter =
      cursorContext.type === "frontmatter-field-value"
        ? cursorContext.frontmatter
        : undefined;
    const excludeValues =
      itemIndex !== undefined
        ? getSiblingValues(
            context,
            getSchemaFieldPath(fieldPath),
            entity.entityIndex,
            frontmatter,
          )
        : [];

    return { kind: "field-value", cursorContext, context, excludeValues };
  }

  return undefined;
};

export const handleCompletion: LspHandler<
  CompletionParams,
  CompletionItem[]
> = async (params, { context, runtime }) => {
  const { log, kg } = runtime;
  log.debug("COMPLETION");

  const cursorContext = getCursorContext(context, params.position);

  const fallbackInput = getFallbackFieldKeyInput(context, params.position);
  if (fallbackInput) {
    const fallbackCompletions = await getCompletionItems(fallbackInput, kg);
    if (fallbackCompletions.length > 0) return fallbackCompletions;
  }

  const input = buildCompletionInput(cursorContext, context, params.position);
  if (input) {
    const completions = await getCompletionItems(input, kg);
    if (completions.length > 0) return completions;
  }

  if (!input) {
    log.debug("Unsupported completion context", {
      documentType: cursorContext.documentType,
      type: cursorContext.type,
    });
  }

  return [];
};

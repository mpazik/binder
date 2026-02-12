import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  type LineCounter,
  type Pair,
  type ParsedNode,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import type {
  Position as LspPosition,
  Range as LspRange,
} from "vscode-languageserver/node";
import {
  type EntitySchema,
  type FieldAttrDef,
  type FieldDef,
  type FieldKey,
  type FieldPath,
  getFieldDefNested,
  getTypeFieldAttrs,
  getTypeFieldKey,
  type TypeDef,
} from "@binder/db";
import type { Position as UnistPosition } from "unist";
import { findYamlContext, type YamlPath } from "../document/yaml-cst.ts";
import type { FieldSlotMapping } from "../document/template.ts";
import type { EntityMapping } from "./entity-mapping.ts";
import {
  type DocumentContext,
  type FrontmatterContext,
  type MarkdownDocumentContext,
  type YamlDocumentContext,
} from "./document-context.ts";

export type CursorEntityContext = {
  mapping: EntityMapping;
  entityIndex: number;
  typeDef?: TypeDef;
};

type CursorContextBase = {
  position: LspPosition;
  entity: CursorEntityContext;
};

export type YamlFieldKeyContext = CursorContextBase & {
  documentType: "yaml";
  type: "field-key";
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  range: LspRange;
};

export type YamlFieldValueContext = CursorContextBase & {
  documentType: "yaml";
  type: "field-value";
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  currentValue?: string;
  range?: LspRange;
  itemIndex?: number;
};

export type YamlNoneContext = CursorContextBase & {
  documentType: "yaml";
  type: "none";
};

export type YamlCursorContext =
  | YamlFieldKeyContext
  | YamlFieldValueContext
  | YamlNoneContext;

export type InlineElementContext =
  | { kind: "link"; url: string; text: string }
  | { kind: "checkbox"; checked: boolean }
  | { kind: "mention"; username: string };

export type MarkdownFieldValueContext = CursorContextBase & {
  documentType: "markdown";
  type: "field-value";
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  currentValue?: string;
  range: LspRange;
  itemIndex?: number;
  slot: FieldSlotMapping;
  inlineElement?: InlineElementContext;
};

export type MarkdownTemplateContext = CursorContextBase & {
  documentType: "markdown";
  type: "template";
  templateKey: string;
};

export type MarkdownNoneContext = CursorContextBase & {
  documentType: "markdown";
  type: "none";
};

export type MarkdownFrontmatterFieldKeyContext = CursorContextBase & {
  documentType: "markdown";
  type: "frontmatter-field-key";
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  range: LspRange;
  frontmatter: FrontmatterContext;
};

export type MarkdownFrontmatterFieldValueContext = CursorContextBase & {
  documentType: "markdown";
  type: "frontmatter-field-value";
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  currentValue?: string;
  range?: LspRange;
  itemIndex?: number;
  frontmatter: FrontmatterContext;
};

export type MarkdownCursorContext =
  | MarkdownFieldValueContext
  | MarkdownFrontmatterFieldKeyContext
  | MarkdownFrontmatterFieldValueContext
  | MarkdownTemplateContext
  | MarkdownNoneContext;

export type CursorContext = YamlCursorContext | MarkdownCursorContext;

const findSeqIndex = (path: YamlPath, offset: number): number => {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (node && typeof node === "object" && !("key" in node) && isSeq(node)) {
      const seq = node as YAMLSeq;
      for (let j = 0; j < seq.items.length; j++) {
        const item = seq.items[j];
        if (item && typeof item === "object" && "range" in item) {
          const [start, , end] = item.range as [number, number, number];
          if (offset >= start && offset <= end) {
            return j;
          }
        }
      }
    }
  }
  return 0;
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

export const unistPositionToLspRange = (position: UnistPosition): LspRange => ({
  start: {
    line: position.start.line - 1,
    character: position.start.column - 1,
  },
  end: { line: position.end.line - 1, character: position.end.column - 1 },
});

export const isPositionInRange = (
  position: LspPosition,
  range: LspRange,
): boolean =>
  (position.line > range.start.line ||
    (position.line === range.start.line &&
      position.character >= range.start.character)) &&
  (position.line < range.end.line ||
    (position.line === range.end.line &&
      position.character <= range.end.character));

const getCursorEntityContext = (
  context: DocumentContext,
  position: LspPosition,
  yamlPath?: YamlPath,
): CursorEntityContext => {
  const { entityMappings, schema } = context;

  if (entityMappings.kind === "single") {
    const mapping = entityMappings.mapping;
    const typeDef =
      mapping.status === "matched" ? schema.types[mapping.type] : undefined;
    return { mapping, entityIndex: 0, typeDef };
  }

  if (
    entityMappings.kind === "list" &&
    context.documentType === "yaml" &&
    yamlPath
  ) {
    const parsed = context.parsed;
    const offset = positionToOffset(position, parsed.lineCounter);
    const entityIndex = findSeqIndex(yamlPath, offset);
    const mapping = entityMappings.mappings[entityIndex];
    if (mapping) {
      const typeDef =
        mapping.status === "matched" ? schema.types[mapping.type] : undefined;
      return { mapping, entityIndex, typeDef };
    }
  }

  const mapping =
    entityMappings.kind === "list"
      ? (entityMappings.mappings[0] ?? { status: "new" as const })
      : entityMappings.mapping;
  const typeDef =
    mapping.status === "matched" ? schema.types[mapping.type] : undefined;
  return { mapping, entityIndex: 0, typeDef };
};

const buildFieldPathFromYaml = (
  path: YamlPath,
  offset: number,
  isListFile: boolean,
): { fieldPath: FieldPath; itemIndex?: number } => {
  const fieldPath: string[] = [];
  let itemIndex: number | undefined;
  let skippedItemsWrapper = false;

  for (const node of path) {
    if (isPair(node) && isScalar(node.key)) {
      const key = String(node.key.value);
      if (isListFile && !skippedItemsWrapper && key === ITEMS_WRAPPER_KEY) {
        skippedItemsWrapper = true;
        continue;
      }
      fieldPath.push(key);
    }

    if (node && typeof node === "object" && !("key" in node) && isSeq(node)) {
      if (isListFile && skippedItemsWrapper && fieldPath.length === 0) {
        continue;
      }
      const seq = node as YAMLSeq;
      for (let j = 0; j < seq.items.length; j++) {
        const item = seq.items[j];
        if (item && typeof item === "object" && "range" in item) {
          const [start, , end] = item.range as [number, number, number];
          if (offset >= start && offset <= end) {
            itemIndex = j;
            fieldPath.push(String(j));
            break;
          }
        }
      }
    }
  }

  return { fieldPath, itemIndex };
};

const extractCurrentValue = (
  node: ParsedNode | Pair | null,
): string | undefined => {
  if (!node) return undefined;
  if (isScalar(node)) return String(node.value ?? "");
  if (isPair(node) && isScalar(node.value))
    return String(node.value.value ?? "");
  return undefined;
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

export type FieldInfo = {
  def: FieldDef;
  attrs?: FieldAttrDef;
};

export const getFieldDefForType = (
  fieldKey: FieldKey,
  typeDef: TypeDef | undefined,
  schema: EntitySchema,
): FieldInfo | undefined => {
  if (!(fieldKey in schema.fields)) return undefined;

  const def = schema.fields[fieldKey];
  if (!def) return undefined;

  const attrs = findFieldAttrsInType(fieldKey, typeDef);
  return { def, attrs };
};

export type FieldMappingMatch = {
  mapping: FieldSlotMapping;
  range: LspRange;
};

const getYamlCursorContext = (
  context: YamlDocumentContext,
  position: LspPosition,
): YamlCursorContext => {
  const { parsed, schema, typeDef } = context;

  if (!parsed.doc.contents) {
    return {
      documentType: "yaml",
      type: "none",
      position,
      entity: getCursorEntityContext(context, position),
    };
  }

  const offset = positionToOffset(position, parsed.lineCounter);
  const yamlContext = findYamlContext(parsed.doc.contents, offset);
  const entity = getCursorEntityContext(context, position, yamlContext.path);

  if (yamlContext.type === "key") {
    const fieldKey = isScalar(yamlContext.node)
      ? String(yamlContext.node.value)
      : undefined;

    if (!fieldKey) {
      return { documentType: "yaml", type: "none", position, entity };
    }

    const fieldInfo = getFieldDefForType(fieldKey, typeDef, schema);
    if (!fieldInfo) {
      return { documentType: "yaml", type: "none", position, entity };
    }

    const range =
      yamlContext.node && "range" in yamlContext.node
        ? yamlRangeToLspRange(
            yamlContext.node.range as [number, number, number],
            parsed.lineCounter,
          )
        : { start: position, end: position };

    return {
      documentType: "yaml",
      type: "field-key",
      position,
      entity,
      fieldPath: [fieldKey],
      fieldDef: fieldInfo.def,
      fieldAttrs: fieldInfo.attrs,
      range,
    };
  }

  if (yamlContext.type === "value" || yamlContext.type === "seq-item") {
    const isListFile = context.entityMappings.kind === "list";
    const { fieldPath, itemIndex } = buildFieldPathFromYaml(
      yamlContext.path,
      offset,
      isListFile,
    );

    const schemaPath = getSchemaFieldPath(fieldPath);
    const fieldDef = getFieldDefNested(schema, schemaPath);

    if (!fieldDef || schemaPath.length === 0) {
      return { documentType: "yaml", type: "none", position, entity };
    }

    const fieldInfo = getFieldDefForType(schemaPath[0]!, typeDef, schema);

    const range =
      yamlContext.node && "range" in yamlContext.node
        ? yamlRangeToLspRange(
            yamlContext.node.range as [number, number, number],
            parsed.lineCounter,
          )
        : undefined;

    return {
      documentType: "yaml",
      type: "field-value",
      position,
      entity,
      fieldPath,
      fieldDef,
      fieldAttrs: fieldInfo?.attrs,
      currentValue: extractCurrentValue(yamlContext.node),
      range,
      itemIndex,
    };
  }

  return { documentType: "yaml", type: "none", position, entity };
};

const findFieldMappingAtPosition = (
  fieldMappings: FieldSlotMapping[],
  position: LspPosition,
): FieldMappingMatch | undefined => {
  for (const mapping of fieldMappings) {
    const range = unistPositionToLspRange(mapping.position);
    if (isPositionInRange(position, range)) {
      return { mapping, range };
    }
  }
  return undefined;
};

const getFieldInfoFromPath = (
  path: FieldPath,
  schema: EntitySchema,
  typeDef?: TypeDef,
): FieldInfo | undefined => {
  const def = getFieldDefNested(schema, path);
  if (!def) return undefined;

  const attrs =
    path.length === 1 ? findFieldAttrsInType(path[0]!, typeDef) : undefined;

  return { def, attrs };
};

const offsetLspRange = (range: LspRange, lineOffset: number): LspRange => ({
  start: {
    line: range.start.line + lineOffset,
    character: range.start.character,
  },
  end: { line: range.end.line + lineOffset, character: range.end.character },
});

const getFrontmatterCursorContext = (
  context: MarkdownDocumentContext,
  position: LspPosition,
  entity: CursorEntityContext,
  fm: FrontmatterContext,
): MarkdownCursorContext | undefined => {
  const { parsed, lineOffset, preambleKeys } = fm;
  const { schema, typeDef } = context;

  if (!parsed.doc.contents) return undefined;

  const localPosition: LspPosition = {
    line: position.line - lineOffset,
    character: position.character,
  };
  const offset = positionToOffset(localPosition, parsed.lineCounter);
  const yamlContext = findYamlContext(parsed.doc.contents, offset);

  if (yamlContext.type === "key") {
    const fieldKey = isScalar(yamlContext.node)
      ? String(yamlContext.node.value)
      : undefined;
    if (!fieldKey) return undefined;

    if (!preambleKeys.includes(fieldKey)) return undefined;

    const fieldInfo = getFieldDefForType(fieldKey, typeDef, schema);
    if (!fieldInfo) return undefined;

    const localRange =
      yamlContext.node && "range" in yamlContext.node
        ? yamlRangeToLspRange(
            yamlContext.node.range as [number, number, number],
            parsed.lineCounter,
          )
        : { start: localPosition, end: localPosition };

    return {
      documentType: "markdown",
      type: "frontmatter-field-key",
      position,
      entity,
      fieldPath: [fieldKey],
      fieldDef: fieldInfo.def,
      fieldAttrs: fieldInfo.attrs,
      range: offsetLspRange(localRange, lineOffset),
      frontmatter: fm,
    };
  }

  if (yamlContext.type === "value" || yamlContext.type === "seq-item") {
    const { fieldPath, itemIndex } = buildFieldPathFromYaml(
      yamlContext.path,
      offset,
      false,
    );

    const schemaPath = getSchemaFieldPath(fieldPath);
    const fieldDef = getFieldDefNested(schema, schemaPath);
    if (!fieldDef || schemaPath.length === 0) return undefined;

    if (!preambleKeys.includes(schemaPath[0]!)) return undefined;

    const fieldInfo = getFieldDefForType(schemaPath[0]!, typeDef, schema);

    const localRange =
      yamlContext.node && "range" in yamlContext.node
        ? yamlRangeToLspRange(
            yamlContext.node.range as [number, number, number],
            parsed.lineCounter,
          )
        : undefined;

    return {
      documentType: "markdown",
      type: "frontmatter-field-value",
      position,
      entity,
      fieldPath,
      fieldDef,
      fieldAttrs: fieldInfo?.attrs,
      currentValue: extractCurrentValue(yamlContext.node),
      range: localRange ? offsetLspRange(localRange, lineOffset) : undefined,
      itemIndex,
      frontmatter: fm,
    };
  }

  return undefined;
};

// The unist position for a `yaml` node (from remark-frontmatter) includes the
// `---` delimiter lines. A cursor on a delimiter will enter
// getFrontmatterCursorContext, which finds no YAML key/value at those offsets
// and returns undefined, falling through harmlessly to the body logic.
const isCursorInFrontmatter = (
  position: LspPosition,
  root: MarkdownDocumentContext["parsed"]["root"],
): boolean => {
  const yamlNode = root.children.find((child) => child.type === "yaml");
  if (!yamlNode?.position) return false;

  const range = unistPositionToLspRange(yamlNode.position);
  return isPositionInRange(position, range);
};

const getMarkdownCursorContext = (
  context: MarkdownDocumentContext,
  position: LspPosition,
): MarkdownCursorContext => {
  const { fieldMappings, schema, typeDef, navigationItem, frontmatter } =
    context;
  const entity = getCursorEntityContext(context, position);

  if (frontmatter && isCursorInFrontmatter(position, context.parsed.root)) {
    const fmContext = getFrontmatterCursorContext(
      context,
      position,
      entity,
      frontmatter,
    );
    if (fmContext) return fmContext;
  }

  const match = findFieldMappingAtPosition(fieldMappings, position);

  if (match) {
    const fieldInfo = getFieldInfoFromPath(match.mapping.path, schema, typeDef);

    if (fieldInfo) {
      return {
        documentType: "markdown",
        type: "field-value",
        position,
        entity,
        fieldPath: match.mapping.path,
        fieldDef: fieldInfo.def,
        fieldAttrs: fieldInfo.attrs,
        range: match.range,
        slot: match.mapping,
      };
    }
  }

  if (navigationItem.template) {
    return {
      documentType: "markdown",
      type: "template",
      position,
      entity,
      templateKey: navigationItem.template,
    };
  }

  return { documentType: "markdown", type: "none", position, entity };
};

export const getCursorContext = (
  context: DocumentContext,
  position: LspPosition,
): CursorContext => {
  if (context.documentType === "yaml") {
    return getYamlCursorContext(context, position);
  }
  return getMarkdownCursorContext(context, position);
};

const ITEMS_WRAPPER_KEY = "items";

export const getSchemaFieldPath = (fieldPath: FieldPath): FieldPath =>
  fieldPath.filter((p) => !/^\d+$/.test(p));

const extractSeqValues = (node: ParsedNode): string[] => {
  if (!isSeq(node)) return [];
  const values: string[] = [];
  for (const item of node.items) {
    if (isScalar(item)) {
      values.push(String(item.value));
    } else if (isMap(item)) {
      const mapItem = item as YAMLMap.Parsed;
      const firstPair = mapItem.items[0];
      if (firstPair && isPair(firstPair) && isScalar(firstPair.key)) {
        values.push(String(firstPair.key.value));
      }
    }
  }
  return values;
};

const findValuesAtPath = (
  node: ParsedNode | null,
  remainingPath: string[],
): string[] => {
  if (!node || !("items" in node)) return [];

  const [nextKey, ...rest] = remainingPath;

  for (const item of node.items as Pair[]) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    if (String(item.key.value) !== nextKey) continue;

    return rest.length === 0
      ? extractSeqValues(item.value as ParsedNode)
      : findValuesAtPath(item.value as ParsedNode, rest);
  }

  return [];
};

export const getSiblingValues = (
  context: DocumentContext,
  fieldPath: FieldPath,
  entityIndex = 0,
  frontmatter?: FrontmatterContext,
): string[] => {
  const schemaPath = getSchemaFieldPath(fieldPath);
  if (schemaPath.length === 0) return [];

  if (frontmatter?.parsed.doc.contents) {
    return findValuesAtPath(frontmatter.parsed.doc.contents, [...schemaPath]);
  }

  if (context.documentType !== "yaml") return [];

  const { parsed, entityMappings } = context;
  if (!parsed.doc.contents) return [];

  let startNode: ParsedNode | null = parsed.doc.contents;

  if (entityMappings.kind === "list" && isMap(startNode)) {
    const itemsSeq = startNode.get(ITEMS_WRAPPER_KEY, true) as
      | YAMLSeq
      | undefined;
    if (itemsSeq && isSeq(itemsSeq)) {
      startNode = (itemsSeq.items[entityIndex] as ParsedNode) ?? null;
    }
  }

  return findValuesAtPath(startNode, [...schemaPath]);
};

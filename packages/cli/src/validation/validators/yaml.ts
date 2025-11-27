import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  type LineCounter,
  type Pair,
  type ParsedNode,
} from "yaml";
import { assertNotEmpty, includes, isErr, type JsonValue } from "@binder/utils";
import {
  type EntityNsType,
  getAllFieldsForType,
  getFieldDef,
  type Includes,
  type IncludesValue,
  isFieldInSchema,
  type NamespaceEditable,
  systemFieldKeys,
  validateDataType,
} from "@binder/db";
import type { ParsedYaml } from "../../document/yaml-cst.ts";
import {
  createValidationError,
  type ValidationContext,
  type ValidationError,
  type ValidationRange,
  type Validator,
  zeroRange,
} from "../types.ts";
import { rangeToValidationRange } from "../utils.ts";
import { getTypeFromFilters } from "../../utils/query.ts";

type RangeNode = { range?: [number, number, number] | null };

const hasRange = (node: unknown): node is ParsedNode =>
  node !== null &&
  typeof node === "object" &&
  "range" in node &&
  Array.isArray(node.range);

const getRange = (node: unknown, lc: LineCounter): ValidationRange =>
  hasRange(node) ? rangeToValidationRange(node.range, lc) : zeroRange;

const expectKeys = (
  node: ParsedNode | Pair,
  allowedKeys: string[],
  lc: LineCounter,
): ValidationError[] => {
  if (isPair(node) || !isMap(node)) return [];
  return node.items.flatMap((item) => {
    if (!isPair(item) || !isScalar(item.key)) return [];
    const key = String(item.key.value);
    if (allowedKeys.includes(key)) return [];
    return [
      createValidationError(
        "unexpected-field",
        `Unexpected field '${key}'. Only ${allowedKeys.map((k) => `'${k}'`).join(", ")} allowed.`,
        getRange(item.key, lc),
        "error",
        {
          key,
          allowedKeys,
        },
      ),
    ];
  });
};

const yamlNodeToJson = (node: ParsedNode | null): JsonValue | undefined => {
  if (node === null) return undefined;
  if (isScalar(node)) return node.value as JsonValue;
  if (isSeq(node)) {
    const result: JsonValue[] = [];
    for (const item of node.items) {
      const value = yamlNodeToJson(item as ParsedNode);
      if (value !== undefined) result.push(value);
    }
    return result;
  }
  if (isMap(node)) {
    const obj: Record<string, JsonValue> = {};
    for (const item of node.items) {
      if (isPair(item) && isScalar(item.key)) {
        const key = String(item.key.value);
        const value = yamlNodeToJson(item.value as ParsedNode);
        if (value !== undefined) obj[key] = value;
      }
    }
    return obj;
  }
  return undefined;
};

const getNestedIncludes = (
  includesValue: IncludesValue | undefined,
): Includes | undefined => {
  if (!includesValue || includesValue === true) return undefined;
  if (typeof includesValue === "object" && "includes" in includesValue)
    return includesValue.includes;
  return includesValue as Includes;
};

const visitEntityNode = <N extends NamespaceEditable>(
  node: unknown,
  entityType: EntityNsType[N],
  context: ValidationContext<N>,
  lc: LineCounter,
  currentIncludes?: Includes,
): ValidationError[] => {
  if (!isMap(node))
    return [
      createValidationError(
        "invalid-structure",
        "Each item must be a mapping (object)",
        getRange(node as RangeNode, lc),
        "error",
      ),
    ];

  const errors: ValidationError[] = [];
  const schema = context.schema;
  const allFieldsForType = getAllFieldsForType(entityType, schema);

  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) {
      errors.push(
        createValidationError(
          "invalid-structure",
          "Expected key-value pair with scalar key",
          getRange(item as RangeNode, lc),
          "error",
        ),
      );
      continue;
    }

    const fieldKey = String(item.key.value);

    if (!isFieldInSchema(fieldKey, schema)) {
      errors.push(
        createValidationError(
          "invalid-field",
          `Field '${fieldKey}' does not exist in schema`,
          getRange(item.key, lc),
          "error",
          { fieldKey },
        ),
      );
      continue;
    }

    if (!allFieldsForType.includes(fieldKey)) {
      errors.push(
        createValidationError(
          "extra-field",
          `Field '${fieldKey}' is not part of type '${entityType}'`,
          getRange(item.key, lc),
          "warning",
          { fieldKey, entityType },
        ),
      );
    }

    if (includes(systemFieldKeys, fieldKey)) continue;

    const fieldDef = getFieldDef(schema, fieldKey);
    if (!fieldDef) {
      errors.push(
        createValidationError(
          "missing-field-definition",
          `Field '${fieldKey}' exists in schema but has no definition`,
          getRange(item.key, lc),
          "error",
          { fieldKey },
        ),
      );
      continue;
    }

    const valueNode = item.value;

    const nestedIncludes =
      currentIncludes &&
      getNestedIncludes(currentIncludes[fieldKey] as IncludesValue);

    if (fieldDef.dataType === "relation" && nestedIncludes) {
      const range = fieldDef.range;
      assertNotEmpty(range, `${fieldKey}'s range`);
      const relatedType = range![0] as EntityNsType[N];

      const visit = fieldDef.allowMultiple
        ? visitEntityNodeSeq
        : visitEntityNode;
      errors.push(
        ...visit(valueNode, relatedType, context, lc, nestedIncludes),
      );
    } else {
      const jsonValue = yamlNodeToJson(valueNode as ParsedNode);
      if (jsonValue === undefined || jsonValue === null) continue;

      const validationResult = validateDataType(fieldDef, jsonValue);
      if (isErr(validationResult)) {
        errors.push(
          createValidationError(
            "invalid-value",
            validationResult.error.message ?? "Invalid value",
            getRange(valueNode, lc),
            "error",
            { fieldKey, value: jsonValue },
          ),
        );
      }
    }
  }

  return errors;
};

const visitEntityNodeSeq = <N extends NamespaceEditable>(
  yamlNode: unknown,
  entityType: EntityNsType[N],
  context: ValidationContext<N>,
  lc: LineCounter,
  currentIncludes?: Includes,
): ValidationError[] => {
  if (!isSeq(yamlNode))
    return [
      createValidationError(
        "invalid-structure",
        "Field 'items' must be a sequence (array)",
        getRange(yamlNode, lc),
      ),
    ];

  return yamlNode.items.flatMap((entityNode) =>
    visitEntityNode(entityNode, entityType, context, lc, currentIncludes),
  );
};

const visitDirectoryNode = <N extends NamespaceEditable>(
  node: ParsedNode,
  entityType: EntityNsType[N],
  context: ValidationContext<N>,
  lc: LineCounter,
  currentIncludes?: Includes,
): ValidationError[] => {
  if (!isMap(node))
    return [
      createValidationError(
        "invalid-structure",
        "Expected a mapping (object)",
        getRange(node, lc),
      ),
    ];

  const keyErrors = expectKeys(node, ["items"], lc);
  const items = node.get("items", true);

  return [
    ...keyErrors,
    ...visitEntityNodeSeq(items, entityType, context, lc, currentIncludes),
  ];
};

export const createYamlValidator = (): Validator<ParsedYaml> => ({
  validate: <N extends NamespaceEditable>(
    { doc, lineCounter: lc }: ParsedYaml,
    context: ValidationContext<N>,
  ) => {
    if (doc.errors && doc.errors.length > 0) {
      const errors: ValidationError[] = [];
      for (const docError of doc.errors) {
        const range =
          docError.pos?.length === 2
            ? rangeToValidationRange([docError.pos[0], 0, docError.pos[1]], lc)
            : zeroRange;
        errors.push(
          createValidationError("yaml-syntax-error", docError.message, range),
        );
      }
      return errors;
    }

    if (!doc.contents)
      return [
        createValidationError("empty-document", "Document has no content"),
      ];

    if (!context.navigationItem)
      return [
        createValidationError(
          "missing-navigation",
          "No navigation item found for this file",
        ),
      ];

    const isDirectory = !!context.navigationItem.query;
    const currentIncludes = isDirectory
      ? context.navigationItem.query?.includes
      : context.navigationItem.includes;

    const entityType = isDirectory
      ? context.navigationItem.query?.filters
        ? getTypeFromFilters<N>(context.navigationItem.query?.filters)
        : undefined
      : context.navigationItem.where
        ? getTypeFromFilters<N>(context.navigationItem.where)
        : undefined;
    if (!entityType)
      return [
        createValidationError(
          "missing-type-filter",
          "Cannot determine entity type from navigation filters",
        ),
      ];

    const visit = isDirectory ? visitDirectoryNode : visitEntityNode;
    return visit(doc.contents, entityType, context, lc, currentIncludes);
  },
});

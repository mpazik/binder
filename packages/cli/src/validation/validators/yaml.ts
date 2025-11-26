import { isMap, isPair, isScalar, isSeq } from "yaml";
import type { ParsedNode } from "yaml";
import { type JsonValue, includes, isErr } from "@binder/utils";
import {
  type EntityNsType,
  getAllFieldsForType,
  isFieldInSchema,
  type NamespaceEditable,
  systemFieldKeys,
  validateDataType,
} from "@binder/db";
import type { ParsedYaml, parseYamlDocument } from "../../document/yaml-cst.ts";
import type {
  ValidationContext,
  ValidationError,
  Validator,
} from "../types.ts";
import { createValidationError } from "../types.ts";
import { rangeToValidationRange } from "../utils.ts";

const hasRange = (node: unknown): node is ParsedNode => {
  return (
    node !== null &&
    typeof node === "object" &&
    "range" in node &&
    Array.isArray(node.range)
  );
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

const visitEntityNode = <N extends NamespaceEditable>(
  node: ParsedNode,
  context: ValidationContext<N>,
  errors: ValidationError[],
  lineCounter: ReturnType<typeof parseYamlDocument>["lineCounter"],
): void => {
  if (!isMap(node)) return;

  let entityType: EntityNsType[N] | undefined;

  for (const item of node.items) {
    if (isPair(item) && isScalar(item.key)) {
      const key = String(item.key.value);
      if (key === "type" && isScalar(item.value)) {
        entityType = String(item.value.value) as EntityNsType[N];
        break;
      }
    }
  }

  for (const item of node.items) {
    if (!isPair(item)) continue;
    if (!isScalar(item.key) || !hasRange(item.key)) continue;

    const fieldKey = String(item.key.value);
    const schema = context.schema;

    if (!isFieldInSchema(fieldKey, schema)) {
      const range = rangeToValidationRange(item.key.range, lineCounter);
      errors.push(
        createValidationError(
          "invalid-field",
          `Field '${fieldKey}' does not exist in schema`,
          range,
          "error",
          { fieldKey },
        ),
      );
      continue;
    }

    if (entityType && fieldKey in schema.fields) {
      const allFields = getAllFieldsForType(entityType, schema);
      if (!allFields.includes(fieldKey)) {
        const range = rangeToValidationRange(item.key.range, lineCounter);
        errors.push(
          createValidationError(
            "extra-field",
            `Field '${fieldKey}' is not part of type '${entityType}'`,
            range,
            "warning",
            { fieldKey, entityType },
          ),
        );
      }
    }

    if (includes(systemFieldKeys, fieldKey)) continue;

    const fieldDef = (schema.fields as Record<string, unknown>)[fieldKey];
    if (!fieldDef || typeof fieldDef !== "object" || !("dataType" in fieldDef))
      continue;

    const typedFieldDef = fieldDef as Parameters<typeof validateDataType>[0];
    const valueNode = item.value as ParsedNode | null;
    if (valueNode === null) continue;

    const jsonValue = yamlNodeToJson(valueNode);
    if (jsonValue === undefined || jsonValue === null) continue;

    // For YAML arrays without allowMultiple, validate as if allowMultiple were true
    // This is lenient validation for user-edited files where array syntax is common
    const effectiveFieldDef =
      Array.isArray(jsonValue) && !typedFieldDef.allowMultiple
        ? { ...typedFieldDef, allowMultiple: true }
        : typedFieldDef;

    const validationResult = validateDataType(effectiveFieldDef, jsonValue);
    if (isErr(validationResult) && hasRange(valueNode)) {
      const range = rangeToValidationRange(valueNode.range, lineCounter);
      errors.push(
        createValidationError(
          "invalid-value",
          validationResult.error.message ?? "Invalid value",
          range,
          "error",
          { fieldKey, value: jsonValue },
        ),
      );
    }
  }
};

const visitDirectoryNode = <N extends NamespaceEditable>(
  node: ParsedNode,
  context: ValidationContext<N>,
  errors: ValidationError[],
  lineCounter: ReturnType<typeof parseYamlDocument>["lineCounter"],
): void => {
  if (!isMap(node)) return;

  for (const item of node.items) {
    if (isPair(item) && isScalar(item.key)) {
      const key = String(item.key.value);
      if (key === "items" && isSeq(item.value)) {
        for (const entityNode of item.value.items) {
          if (hasRange(entityNode)) {
            visitEntityNode(entityNode, context, errors, lineCounter);
          }
        }
      }
    }
  }
};

export const createYamlValidator = (): Validator<ParsedYaml> => ({
  validate: ({ doc, lineCounter }, context) => {
    const errors: ValidationError[] = [];

    if (doc.errors && doc.errors.length > 0) {
      for (const error of doc.errors) {
        const range =
          error.pos && error.pos.length >= 2
            ? rangeToValidationRange(
                [error.pos[0], 0, error.pos[1]],
                lineCounter,
              )
            : {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              };

        errors.push(
          createValidationError(
            "yaml-syntax-error",
            error.message,
            range,
            "error",
          ),
        );
      }
      return errors;
    }

    if (doc.contents === null) {
      return errors;
    }

    if (!context.navigationItem) {
      return errors;
    }

    const isDirectory = !!context.navigationItem.query;

    if (hasRange(doc.contents)) {
      if (isDirectory) {
        visitDirectoryNode(doc.contents, context, errors, lineCounter);
      } else {
        visitEntityNode(doc.contents, context, errors, lineCounter);
      }
    }

    return errors;
  },
});

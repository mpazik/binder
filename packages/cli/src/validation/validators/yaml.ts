import { isMap, isPair, isScalar, isSeq } from "yaml";
import type { ParsedNode } from "yaml";
import {
  type EntityNsType,
  getAllFieldsForType,
  isFieldInSchema,
  type NamespaceEditable,
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
    } else if (entityType && fieldKey in schema.fields) {
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

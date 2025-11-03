import {
  createError,
  err,
  isErr,
  isIsoDate,
  isIsoTimestamp,
  type JsonValue,
  okVoid,
  type Result,
} from "@binder/utils";
import { isValidUid } from "./utils/uid.ts";
import type { CoreDataType, FieldDef } from "./model";
import { FiltersSchema, QueryParamsSchema } from "./model";

export type DataTypeValidator = (
  value: JsonValue,
  fieldDef: FieldDef<CoreDataType>,
) => Result<void>;

const validationError = (message: string, data?: object) =>
  err(createError("validation-error", message, data));

export const dataTypeValidators: {
  [K in CoreDataType]: DataTypeValidator;
} = {
  seqId: (value) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      return okVoid;
    return validationError(
      `Expected non-negative integer for seqId, got: ${typeof value}`,
    );
  },

  uid: (value) => {
    if (typeof value === "string" && isValidUid(value)) return okVoid;
    return validationError(`Invalid UID format: ${value}`);
  },

  relation: (value) => {
    if (typeof value === "string" && value.length > 0) return okVoid;
    return validationError(`Expected non-empty string for relation`);
  },

  boolean: (value) => {
    if (typeof value === "boolean") return okVoid;
    return validationError(`Expected boolean, got: ${typeof value}`);
  },

  integer: (value) => {
    if (typeof value === "number" && Number.isInteger(value)) return okVoid;
    return validationError(`Expected integer, got: ${typeof value}`);
  },

  decimal: (value) => {
    if (typeof value === "number" && !isNaN(value) && isFinite(value))
      return okVoid;
    return validationError(`Expected number, got: ${typeof value}`);
  },

  string: (value) => {
    if (typeof value === "string") return okVoid;
    return validationError(`Expected string, got: ${typeof value}`);
  },

  text: (value) => {
    if (typeof value === "string") return okVoid;
    return validationError(`Expected string for text, got: ${typeof value}`);
  },

  date: (value) => {
    if (typeof value === "string" && isIsoDate(value)) return okVoid;
    return validationError(
      `Expected ISO date format (YYYY-MM-DD), got: ${value}`,
    );
  },

  datetime: (value) => {
    if (typeof value === "string" && isIsoTimestamp(value)) return okVoid;
    return validationError(`Expected ISO timestamp format, got: ${value}`);
  },

  option: (value, fieldDef) => {
    if (typeof value !== "string" || value.length === 0)
      return validationError(`Expected non-empty string for option`);

    if (fieldDef.options && fieldDef.options.length > 0) {
      const validKeys = fieldDef.options.map((opt) => opt.key);
      if (!validKeys.includes(value)) {
        return validationError(
          `Invalid option value: ${value}. Expected one of: ${validKeys.join(", ")}`,
        );
      }
    }

    return okVoid;
  },

  object: (value) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return okVoid;
    return validationError(`Expected object, got: ${typeof value}`);
  },

  formula: (value) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return okVoid;
    return validationError(`Expected object for formula, got: ${typeof value}`);
  },

  condition: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return validationError(
        `Expected object for condition, got: ${typeof value}`,
      );

    const parseResult = FiltersSchema.safeParse(value);
    if (!parseResult.success)
      return validationError(
        `Invalid condition structure: ${parseResult.error.message}`,
      );

    return okVoid;
  },

  query: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return validationError(`Expected object for query, got: ${typeof value}`);

    const parseResult = QueryParamsSchema.safeParse(value);
    if (!parseResult.success)
      return validationError(
        `Invalid query structure: ${parseResult.error.message}`,
      );

    return okVoid;
  },

  optionSet: (value) => {
    if (!Array.isArray(value))
      return validationError(
        `Expected array for optionSet, got: ${typeof value}`,
      );

    for (const item of value) {
      if (typeof item !== "object" || item === null || Array.isArray(item))
        return validationError(
          "Invalid option in optionSet: expected object with key and name",
        );
      const obj = item as Record<string, unknown>;
      if (typeof obj.key !== "string" || typeof obj.name !== "string")
        return validationError(
          "Invalid option in optionSet: expected {key: string, name: string}",
        );
    }

    return okVoid;
  },
};

export const validateDataType = (
  fieldDef: FieldDef<CoreDataType>,
  value: JsonValue,
): Result<void> => {
  const validator = dataTypeValidators[fieldDef.dataType];

  if (!validator)
    return validationError(`Unknown data type: ${fieldDef.dataType}`);

  if (fieldDef.allowMultiple) {
    if (!Array.isArray(value))
      return validationError(
        `Expected array when allowMultiple is true, got: ${typeof value}`,
      );

    for (let i = 0; i < value.length; i++) {
      const result = validator(value[i], fieldDef);
      if (isErr(result))
        return validationError(`Invalid value at index ${i}`, {
          originalError: result.error,
        });
    }
    return okVoid;
  }

  return validator(value, fieldDef);
};

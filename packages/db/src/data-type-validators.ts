import {
  fail,
  isErr,
  isIsoDate,
  isIsoTimestamp,
  type JsonValue,
  okVoid,
  type Result,
} from "@binder/utils";
import { isValidUid } from "./utils/uid.ts";
import type {
  ConfigDataType,
  CoreDataType,
  DataTypeNs,
  FieldDef,
  Namespace,
  NodeDataType,
} from "./model";
import { QueryParamsSchema } from "./model";

export type DataTypeValidator<D extends string> = (
  value: JsonValue,
  fieldDef: FieldDef<D>,
) => Result<void>;

export const coreValidators: { [K in CoreDataType]: DataTypeValidator<K> } = {
  seqId: (value) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      return okVoid;
    return fail(
      "validation-error",
      `Expected non-negative integer for seqId, got: ${typeof value}`,
      undefined,
    );
  },

  uid: (value) => {
    if (typeof value === "string" && isValidUid(value)) return okVoid;
    return fail("validation-error", `Invalid UID format: ${value}`, undefined);
  },

  relation: (value) => {
    if (typeof value === "string" && value.length > 0) return okVoid;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      value[0].length > 0 &&
      typeof value[1] === "object" &&
      value[1] !== null &&
      !Array.isArray(value[1])
    )
      return okVoid;
    return fail(
      "validation-error",
      `Expected non-empty string or [string, object] tuple for relation`,
      undefined,
    );
  },

  boolean: (value) => {
    if (typeof value === "boolean") return okVoid;
    return fail(
      "validation-error",
      `Expected boolean, got: ${typeof value}`,
      undefined,
    );
  },

  integer: (value) => {
    if (typeof value === "number" && Number.isInteger(value)) return okVoid;
    return fail(
      "validation-error",
      `Expected integer, got: ${typeof value}`,
      undefined,
    );
  },

  decimal: (value) => {
    if (typeof value === "number" && !isNaN(value) && isFinite(value))
      return okVoid;
    return fail(
      "validation-error",
      `Expected number, got: ${typeof value}`,
      undefined,
    );
  },

  string: (value) => {
    if (typeof value === "string") return okVoid;
    return fail(
      "validation-error",
      `Expected string, got: ${typeof value}`,
      undefined,
    );
  },

  text: (value) => {
    if (typeof value === "string") return okVoid;
    return fail(
      "validation-error",
      `Expected string for text, got: ${typeof value}`,
      undefined,
    );
  },

  date: (value) => {
    if (typeof value === "string" && isIsoDate(value)) return okVoid;
    return fail(
      "validation-error",
      `Expected ISO date format (YYYY-MM-DD), got: ${value}`,
      undefined,
    );
  },

  datetime: (value) => {
    if (typeof value === "string" && isIsoTimestamp(value)) return okVoid;
    return fail(
      "validation-error",
      `Expected ISO timestamp format, got: ${value}`,
      undefined,
    );
  },
};

export const optionValidator: DataTypeValidator<"option"> = (
  value,
  fieldDef,
) => {
  if (typeof value !== "string" || value.length === 0)
    return fail(
      "validation-error",
      `Expected non-empty string for option`,
      undefined,
    );

  if (fieldDef.options && fieldDef.options.length > 0) {
    const validKeys = fieldDef.options.map((opt) => opt.key);
    if (!validKeys.includes(value)) {
      return fail(
        "validation-error",
        `Invalid option value: ${value}. Expected one of: ${validKeys.join(", ")}`,
        undefined,
      );
    }
  }

  return okVoid;
};

const queryValidator: DataTypeValidator<"query"> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(
      "validation-error",
      `Expected object for query, got: ${typeof value}`,
      undefined,
    );

  const parseResult = QueryParamsSchema.safeParse(value);
  if (!parseResult.success)
    return fail(
      "validation-error",
      `Invalid query structure: ${parseResult.error.message}`,
      undefined,
    );

  return okVoid;
};

const stringValidator: DataTypeValidator<string> = (value) => {
  if (typeof value === "string") return okVoid;
  return fail(
    "validation-error",
    `Expected string, got: ${typeof value}`,
    undefined,
  );
};

export const nodeDataTypeValidators: {
  [K in NodeDataType]: DataTypeValidator<K>;
} = {
  ...coreValidators,
  option: optionValidator,
  fileHash: stringValidator,
  interval: stringValidator,
  duration: stringValidator,
  uri: stringValidator,
  query: queryValidator,
  image: stringValidator,
};

export const configDataTypeValidators: {
  [K in ConfigDataType]: DataTypeValidator<K>;
} = {
  ...coreValidators,
  object: (value) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return okVoid;
    return fail(
      "validation-error",
      `Expected object, got: ${typeof value}`,
      undefined,
    );
  },
  option: optionValidator,
  optionSet: (value) => {
    if (!Array.isArray(value))
      return fail(
        "validation-error",
        `Expected array for optionSet, got: ${typeof value}`,
        undefined,
      );

    for (const item of value) {
      if (typeof item === "string") {
        if (item.length === 0)
          return fail(
            "validation-error",
            "Invalid option in optionSet: string key cannot be empty",
            undefined,
          );
        continue;
      }
      if (typeof item !== "object" || item === null || Array.isArray(item))
        return fail(
          "validation-error",
          "Invalid option in optionSet: expected string or object with key",
          undefined,
        );
      const obj = item as Record<string, unknown>;
      if (typeof obj.key !== "string")
        return fail(
          "validation-error",
          "Invalid option in optionSet: expected {key: string}",
          undefined,
        );
    }

    return okVoid;
  },
};

const createValidateDataType =
  <D extends string>(validators: { [K in D]: DataTypeValidator<K> }) =>
  (fieldDef: FieldDef<D>, value: JsonValue): Result<void> => {
    const validator = validators[fieldDef.dataType];

    if (!validator)
      return fail(
        "validation-error",
        `Unknown data type: ${fieldDef.dataType}`,
        undefined,
      );

    if (fieldDef.allowMultiple) {
      if (!Array.isArray(value))
        return fail(
          "validation-error",
          `Expected array when allowMultiple is true, got: ${typeof value}`,
          undefined,
        );

      for (let i = 0; i < value.length; i++) {
        const result = validator(value[i], fieldDef);
        if (isErr(result))
          return fail("validation-error", `Invalid value at index ${i}`, {
            originalError: result.error,
          });
      }
      return okVoid;
    }

    return validator(value, fieldDef);
  };

type FieldDefValidator<D extends string> = (
  fieldDef: FieldDef<D>,
  value: JsonValue,
) => Result<void>;

export const namespaceDataTypeValidators: {
  [N in Namespace]: FieldDefValidator<DataTypeNs[N]>;
} = {
  node: createValidateDataType(nodeDataTypeValidators),
  config: createValidateDataType(configDataTypeValidators),
  transaction: createValidateDataType(coreValidators),
};

export const validateDataType = <N extends Namespace>(
  namespace: N,
  fieldDef: FieldDef<DataTypeNs[N]>,
  value: JsonValue,
): Result<void> => namespaceDataTypeValidators[namespace](fieldDef, value);

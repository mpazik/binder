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
import {
  type ConfigDataType,
  type CoreDataType,
  type DataTypeNs,
  type FieldDef,
  getPlaintextFormat,
  getRichtextFormat,
  type Namespace,
  type RecordDataType,
  periodFormats,
  QueryParamsSchema,
} from "./model";

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
    );
  },

  uid: (value) => {
    if (typeof value === "string" && isValidUid(value)) return okVoid;
    return fail("validation-error", `Invalid UID format: ${value}`);
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
    );
  },

  boolean: (value) => {
    if (typeof value === "boolean") return okVoid;
    return fail("validation-error", `Expected boolean, got: ${typeof value}`);
  },

  integer: (value) => {
    if (typeof value === "number" && Number.isInteger(value)) return okVoid;
    return fail("validation-error", `Expected integer, got: ${typeof value}`);
  },

  decimal: (value) => {
    if (typeof value === "number" && !isNaN(value) && isFinite(value))
      return okVoid;
    return fail("validation-error", `Expected number, got: ${typeof value}`);
  },

  plaintext: (value, fieldDef) => {
    if (typeof value !== "string")
      return fail(
        "validation-error",
        `Expected string for plaintext, got: ${typeof value}`,
      );
    if (value === "") return okVoid;
    const format = getPlaintextFormat(fieldDef.plaintextFormat);
    const error = format.validate(value, {});
    if (error) return fail("validation-error", error);
    return okVoid;
  },

  richtext: (value, fieldDef) => {
    if (typeof value !== "string")
      return fail(
        "validation-error",
        `Expected string for richtext, got: ${typeof value}`,
      );
    if (value === "") return okVoid;
    const format = getRichtextFormat(fieldDef.richtextFormat);
    const error = format.validate(value, {
      allowMultiple: fieldDef.allowMultiple,
      sectionDepth: fieldDef.sectionDepth,
    });
    if (error) return fail("validation-error", error);
    return okVoid;
  },

  date: (value) => {
    if (typeof value === "string" && isIsoDate(value)) return okVoid;
    return fail(
      "validation-error",
      `Expected ISO date format (YYYY-MM-DD), got: ${value}`,
    );
  },

  datetime: (value) => {
    if (typeof value === "string" && isIsoTimestamp(value)) return okVoid;
    return fail(
      "validation-error",
      `Expected ISO timestamp format, got: ${value}`,
    );
  },

  period: (value, fieldDef) => {
    if (typeof value !== "string")
      return fail(
        "validation-error",
        `Expected string for period, got: ${typeof value}`,
      );
    if (value === "") return okVoid;
    const format: keyof typeof periodFormats = fieldDef.periodFormat ?? "day";
    const formatDef = periodFormats[format];
    const error = formatDef.validate(value, {});
    if (error) return fail("validation-error", error);
    return okVoid;
  },

  option: (value, fieldDef) => {
    if (typeof value !== "string" || value.length === 0)
      return fail("validation-error", `Expected non-empty string for option`);

    if (fieldDef.options && fieldDef.options.length > 0) {
      const validKeys = fieldDef.options.map((opt) => opt.key);
      if (!validKeys.includes(value))
        return fail(
          "validation-error",
          `Invalid option value: ${value}. Expected one of: ${validKeys.join(", ")}`,
        );
    }

    return okVoid;
  },

  uri: (value) => {
    if (typeof value === "string") return okVoid;
    return fail("validation-error", `Expected string, got: ${typeof value}`);
  },
};

const queryValidator: DataTypeValidator<"query"> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(
      "validation-error",
      `Expected object for query, got: ${typeof value}`,
    );

  const parseResult = QueryParamsSchema.safeParse(value);
  if (!parseResult.success)
    return fail(
      "validation-error",
      `Invalid query structure: ${parseResult.error.message}`,
    );

  return okVoid;
};

const stringValidator: DataTypeValidator<string> = (value) => {
  if (typeof value === "string") return okVoid;
  return fail("validation-error", `Expected string, got: ${typeof value}`);
};

export const recordDataTypeValidators: {
  [K in RecordDataType]: DataTypeValidator<K>;
} = {
  ...coreValidators,
  fileHash: stringValidator,
  interval: stringValidator,
  duration: stringValidator,
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
    return fail("validation-error", `Expected object, got: ${typeof value}`);
  },
  json: () => okVoid,
  optionSet: (value) => {
    if (!Array.isArray(value))
      return fail(
        "validation-error",
        `Expected array for optionSet, got: ${typeof value}`,
      );

    for (const item of value) {
      if (typeof item === "string") {
        if (item.length === 0)
          return fail(
            "validation-error",
            "Invalid option in optionSet: string key cannot be empty",
          );
        continue;
      }
      if (typeof item !== "object" || item === null || Array.isArray(item))
        return fail(
          "validation-error",
          "Invalid option in optionSet: expected string or object with key",
        );
      const obj = item as Record<string, unknown>;
      if (typeof obj.key !== "string")
        return fail(
          "validation-error",
          "Invalid option in optionSet: expected {key: string}",
        );
    }

    return okVoid;
  },
  query: queryValidator,
};

const formatValue = (value: JsonValue, maxLen = 50): string => {
  const raw =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  const escaped = raw
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return escaped.length > maxLen ? `${escaped.slice(0, maxLen)}…` : escaped;
};

const createValidateDataType =
  <D extends string>(validators: { [K in D]: DataTypeValidator<K> }) =>
  (fieldDef: FieldDef<D>, value: JsonValue): Result<void> => {
    const validator = validators[fieldDef.dataType];

    if (!validator)
      return fail(
        "validation-error",
        `Unknown data type: ${fieldDef.dataType}`,
      );

    if (fieldDef.allowMultiple) {
      if (!Array.isArray(value))
        return fail(
          "validation-error",
          `Expected array when allowMultiple is true, got: ${typeof value}`,
        );

      for (let i = 0; i < value.length; i++) {
        const result = validator(value[i], fieldDef);
        if (isErr(result)) {
          const preview = formatValue(value[i]);
          const format =
            fieldDef.plaintextFormat ??
            fieldDef.richtextFormat ??
            fieldDef.dataType;
          return fail(
            "validation-error",
            `"${preview}" (at index ${i}) is not a valid ${format}: ${result.error.message}`,
            { data: { originalError: result.error } },
          );
        }
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
  record: createValidateDataType(recordDataTypeValidators),
  config: createValidateDataType(configDataTypeValidators),
  transaction: createValidateDataType(coreValidators),
};

export const validateDataType = <N extends Namespace>(
  namespace: N,
  fieldDef: FieldDef<DataTypeNs[N]>,
  value: JsonValue,
): Result<void> => namespaceDataTypeValidators[namespace](fieldDef, value);

import type { JsonValue, Result } from "@binder/utils";
import { fail, ok, parseJson } from "@binder/utils";
import type { EntityUid } from "./entity.ts";
import type { FieldDef } from "./schema.ts";
import {
  getMultiValueDelimiter,
  getDelimiterString,
  splitByDelimiter,
} from "./text-format.ts";

export type FieldKey = string;
export type FieldPath = readonly FieldKey[];
export type FieldValue = JsonValue;

export const parseFieldPath = (path: string): FieldPath => path.split(".");

export type Fieldset = Record<FieldKey, FieldValue>;
export type FieldValueProvider = (key: FieldKey) => FieldValue;
export type NestedFieldValueProvider = (path: FieldPath) => FieldValue;
export type FieldNestedValue = FieldValue | FieldsetNested;
export type FieldsetNested = {
  [key: FieldKey]: FieldNestedValue;
};

export const isFieldsetNested = (
  value: FieldNestedValue,
): value is FieldsetNested =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const extractUid = (value: FieldNestedValue): EntityUid | undefined => {
  if (typeof value === "string") return value as EntityUid;
  if (isFieldsetNested(value) && typeof value.uid === "string")
    return value.uid as EntityUid;
  return undefined;
};

// 0 is the current entity, 1 its parent, and so on
export type AncestralFieldValueProvider = (
  fieldName: string,
  depth: number,
) => FieldValue;

export type AncestralFieldsetChain = Fieldset[];

export const getNestedValue = (
  fieldset: FieldsetNested,
  path: FieldPath,
): FieldValue | undefined => {
  let current: FieldsetNested = fieldset;

  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    if (!(key in current)) return undefined;

    const next = current[key];
    if (i === path.length - 1) return next as FieldValue;
    if (next === null || typeof next !== "object" || Array.isArray(next))
      return undefined;

    current = next as FieldsetNested;
  }

  return current as FieldValue;
};

export const setNestedValue = (
  fieldset: FieldsetNested,
  path: FieldPath,
  value: FieldValue,
): void => {
  if (path.length === 0) return;

  let current: FieldsetNested = fieldset;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current)) current[key] = {};
    current = current[key] as FieldsetNested;
  }

  current[path[path.length - 1]!] = value;
};

const serializeSingleValue = (value: FieldValue): string => {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const parseFieldValue = (
  raw: string,
  fieldDef: FieldDef,
): Result<FieldValue> => {
  const trimmed = raw.trim();

  if (fieldDef.allowMultiple) {
    if (trimmed === "") return ok([]);
    const delimiter = getMultiValueDelimiter(fieldDef);
    const items = splitByDelimiter(
      trimmed,
      delimiter,
      fieldDef.sectionDepth,
    ).filter((item) => item.length > 0);
    return ok(items);
  }

  if (trimmed === "") return ok(null);

  if (fieldDef.dataType === "seqId" || fieldDef.dataType === "integer") {
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed))
      return fail("invalid-field-value", `Invalid integer: ${trimmed}`);
    return ok(parsed);
  }

  if (fieldDef.dataType === "decimal") {
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed))
      return fail("invalid-field-value", `Invalid decimal: ${trimmed}`);
    return ok(parsed);
  }

  if (fieldDef.dataType === "boolean") {
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "on" || lower === "1")
      return ok(true);
    if (lower === "false" || lower === "no" || lower === "off" || lower === "0")
      return ok(false);
    return fail("invalid-field-value", `Invalid boolean: ${trimmed}`);
  }

  if (fieldDef.dataType === "json")
    return parseJson<JsonValue>(trimmed, `Invalid JSON value: ${trimmed}`);

  return ok(trimmed);
};

export const serializeFieldValue = (
  value: FieldValue | undefined,
  fieldDef: FieldDef,
): string => {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value) && fieldDef.allowMultiple) {
    if (value.length === 0) return "";
    const delimiter = getDelimiterString(getMultiValueDelimiter(fieldDef));
    return value.map(serializeSingleValue).join(delimiter);
  }

  return serializeSingleValue(value);
};

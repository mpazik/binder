import { fail, type JsonValue, ok, type Result } from "@binder/utils";
import type { FieldDef } from "./schema.ts";

export type FieldKey = string;
export type FieldPath = readonly FieldKey[];
export type FieldValue = JsonValue;
export type Fieldset = Record<FieldKey, FieldValue>;
export type FieldValueProvider = (key: FieldKey) => FieldValue;
export type FieldsetNested = {
  [key: FieldKey]: FieldValue | FieldsetNested;
};

export const systemFields = [
  "id",
  "version",
  "createdAt",
  "updatedAt",
] as const;

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

export const parseFieldValue = (
  raw: string,
  fieldDef: Pick<FieldDef, "dataType" | "allowMultiple">,
): Result<FieldValue> => {
  const trimmed = raw.trim();

  if (fieldDef.allowMultiple) {
    if (trimmed === "") return ok([]);
    const items = trimmed.split(",").map((item) => item.trim());
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

  return ok(trimmed);
};

export const formatFieldValue = (
  value: FieldValue | undefined,
  _fieldDef?: FieldDef,
): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value.join(", ");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

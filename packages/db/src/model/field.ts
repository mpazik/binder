import type { JsonValue } from "@binder/utils";
import type { EntityUid } from "./entity.ts";

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

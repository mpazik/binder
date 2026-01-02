import { fail, type JsonValue, ok, type Result } from "@binder/utils";
import type { EntityUid } from "./entity.ts";
import type { FieldDef } from "./schema.ts";

export type FieldKey = string;
export type FieldPath = readonly FieldKey[];
export type FieldValue = JsonValue;
export type Fieldset = Record<FieldKey, FieldValue>;
export type FieldValueProvider = (key: FieldKey) => FieldValue;
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

type MultiValueDelimiter =
  | "comma"
  | "newline"
  | "blankline"
  | "header"
  | "hrule";

const getMultiValueDelimiter = (fieldDef: FieldDef): MultiValueDelimiter => {
  if (fieldDef.dataType === "plaintext") {
    const alphabet = fieldDef.plaintextAlphabet;
    if (alphabet === "line") return "newline";
    if (alphabet === "paragraph") return "blankline";
    return "comma";
  }
  if (fieldDef.dataType === "richtext") {
    const alphabet = fieldDef.richtextAlphabet;
    if (alphabet === "line") return "newline";
    if (alphabet === "block") return "blankline";
    if (alphabet === "section") return "header";
    if (alphabet === "document") return "hrule";
    return "comma";
  }
  return "comma";
};

const splitByHeader = (value: string): string[] => {
  const headerPattern = /^#{1,6}\s/;
  const lines = value.split("\n");
  const sections: string[] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (headerPattern.test(line) && currentSection.length > 0) {
      sections.push(currentSection.join("\n").trim());
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    const trimmed = currentSection.join("\n").trim();
    if (trimmed) sections.push(trimmed);
  }

  return sections;
};

const splitByHorizontalRule = (value: string): string[] =>
  value.split(/^-{3,}\s*$/m).map((item) => item.trim());

const splitByDelimiter = (
  value: string,
  delimiter: MultiValueDelimiter,
): string[] => {
  if (delimiter === "comma") return value.split(",").map((item) => item.trim());

  if (delimiter === "newline")
    return value.split("\n").map((item) => item.trim());

  if (delimiter === "blankline")
    return value.split(/\n\n+/).map((item) => item.trim());

  if (delimiter === "header") return splitByHeader(value);

  if (delimiter === "hrule") return splitByHorizontalRule(value);

  return [value];
};

export const parseFieldValue = (
  raw: string,
  fieldDef: FieldDef,
): Result<FieldValue> => {
  const trimmed = raw.trim();

  if (fieldDef.allowMultiple) {
    if (trimmed === "") return ok([]);
    const delimiter = getMultiValueDelimiter(fieldDef);
    const items = splitByDelimiter(trimmed, delimiter).filter(
      (item) => item.length > 0,
    );
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

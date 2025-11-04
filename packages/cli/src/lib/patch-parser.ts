import type {
  FieldChangeInput,
  FieldChangesetInput,
  FieldKey,
} from "@binder/db";
import { isErr, parseJson } from "@binder/utils";
import { Log } from "../log.ts";

export const patchesDescription =
  "field=value patches. Arrays: field=a,b,c | field+=item | field[0]+=item | field[last]-=item | field[all]-=item | field[0]--";

type ArrayOperation = {
  field: string;
  index?: string | number;
  operator: "=" | "+=" | "-=" | "--";
  value: string;
};

const parseArrayOperation = (patch: string): ArrayOperation | null => {
  const match = patch.match(/^([\w]+)(?:\[([^\]]+)\])?([-+]*=|--)(.*)$/);
  if (!match) return null;

  const [, field, index, operator, value] = match;
  return {
    field: field!,
    index: index,
    operator: operator as ArrayOperation["operator"],
    value: value!,
  };
};

const normalizeIndex = (
  index?: string | number,
): number | "last" | "all" | undefined => {
  if (index === undefined) return undefined;
  if (index === "last" || index === "-1") return "last";
  if (index === "all") return "all";
  const num = Number(index);
  if (isNaN(num)) {
    Log.error("Invalid array index", { index });
    process.exit(1);
  }
  return num;
};

const parseQuotedValue = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const splitCommaSeparated = (value: string): string[] => {
  const quoted = parseQuotedValue(value);
  if (quoted !== value) {
    return [quoted];
  }
  return value.split(",");
};

const parseSimpleValue = (value: string): string => {
  return value;
};

export const parseFieldChange = (fieldChange: string): FieldChangeInput => {
  const arrayOp = parseArrayOperation(fieldChange);
  if (!arrayOp) {
    Log.error("Invalid patch format", { patch: fieldChange });
    process.exit(1);
  }

  const { field, index, operator, value } = arrayOp;

  if (value.startsWith("[") || value.startsWith("{")) {
    const result = parseJson<FieldChangeInput>(value);
    if (isErr(result)) {
      Log.error("Invalid JSON format", { patch: fieldChange });
      process.exit(1);
    }
    return result.data;
  }

  if (operator === "=") {
    if (value === "[]") return [];

    const quotedValue = parseQuotedValue(value);
    if (quotedValue !== value) {
      if (quotedValue === "") return "";
      if (quotedValue === "true") return true;
      if (quotedValue === "false") return false;
      if (/^-?\d+$/.test(quotedValue)) return parseInt(quotedValue, 10);
      if (/^-?\d+\.\d+$/.test(quotedValue)) return parseFloat(quotedValue);
      return quotedValue;
    }

    if (value === "") return "";
    if (value.includes(",")) {
      return splitCommaSeparated(value);
    }

    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
    return value;
  }

  if (operator === "+=") {
    const values = splitCommaSeparated(value);
    const normalizedIndex = normalizeIndex(index);

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (normalizedIndex === undefined) {
        return ["insert", val];
      }
      return ["insert", val, normalizedIndex];
    }

    return values.map((v) => {
      const val = parseSimpleValue(v);
      if (normalizedIndex === undefined) {
        return ["insert", val];
      }
      return ["insert", val, normalizedIndex];
    });
  }

  if (operator === "-=") {
    const values = splitCommaSeparated(value);
    const normalizedIndex = normalizeIndex(index);

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (normalizedIndex === undefined) {
        return ["remove", val];
      }
      return ["remove", val, normalizedIndex];
    }

    return values.map((v) => {
      const val = parseSimpleValue(v);
      if (normalizedIndex === undefined) {
        return ["remove", val];
      }
      return ["remove", val, normalizedIndex];
    });
  }

  if (operator === "--") {
    const normalizedIndex = normalizeIndex(index);
    if (normalizedIndex === undefined) {
      Log.error("Remove by position requires an index", { patch: fieldChange });
      process.exit(1);
    }
    return ["remove", null, normalizedIndex];
  }

  Log.error("Invalid operator", { operator, patch: fieldChange });
  process.exit(1);
};

export const parsePatches = (patches: string[]): FieldChangesetInput => {
  const result: Record<string, FieldChangeInput> = {};
  for (const patch of patches) {
    const arrayOp = parseArrayOperation(patch);
    if (!arrayOp) {
      Log.error("Invalid patch format", { patch });
      process.exit(1);
    }
    const fieldKey = arrayOp.field as FieldKey;
    result[fieldKey] = parseFieldChange(patch);
  }
  return result;
};

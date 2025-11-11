import type {
  FieldChangeInput,
  FieldChangesetInput,
  FieldKey,
} from "@binder/db";
import {
  createError,
  err,
  isErr,
  ok,
  parseJson,
  type Result,
} from "@binder/utils";

export const patchesDescription =
  "field=value patches. Arrays: field=a,b,c | field+=item | field[0]+=item | field[last]-=item | field[all]-=item | field[0]--";

type ArrayOperation = {
  field: string;
  index?: string | number;
  operator: "=" | "+=" | "-=" | "--";
  value: string;
};

const trimSingleQuotes = (str: string): string => {
  if (str.startsWith("'") && str.endsWith("'")) {
    return str.slice(1, -1);
  }
  return str;
};

const parseArrayOperation = (patch: string): ArrayOperation | null => {
  const patchHasOuterQuotes =
    (patch.startsWith("'") && patch.endsWith("'")) ||
    (patch.startsWith('"') && patch.endsWith('"'));
  const trimmedPatch = patchHasOuterQuotes ? patch.slice(1, -1) : patch;
  const match = trimmedPatch.match(/^([\w]+)(?:\[([^\]]+)\])?([-+]*=|--)(.*)$/);
  if (!match) return null;

  const [, field, index, operator, value] = match;
  return {
    field: field!,
    index: index,
    operator: operator as ArrayOperation["operator"],
    value: trimSingleQuotes(value!),
  };
};

const normalizeIndex = (
  index?: string | number,
): Result<number | "last" | "all" | undefined> => {
  if (index === undefined) return ok(undefined);
  if (index === "last" || index === "-1") return ok("last");
  if (index === "all") return ok("all");
  const num = Number(index);
  if (isNaN(num)) {
    return err(
      createError("invalid-array-index", "Invalid array index", { index }),
    );
  }
  return ok(num);
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

const createPatchFormatError = (patch: string) => {
  const missingOperator = !patch.includes("=");
  const hasQuote = patch.includes('"') || patch.includes("'");

  if (missingOperator && hasQuote) {
    return createError(
      "invalid-patch-format",
      "Invalid patch format. If your value contains spaces, quote the entire patch: 'field=value with spaces'",
      { patch },
    );
  }

  return createError("invalid-patch-format", "Invalid patch format", {
    patch,
  });
};

export const parseFieldChange = (
  fieldChange: string,
): Result<FieldChangeInput> => {
  const arrayOp = parseArrayOperation(fieldChange);
  if (!arrayOp) return err(createPatchFormatError(fieldChange));

  const { field, index, operator, value } = arrayOp;

  if (value.startsWith("[") || value.startsWith("{")) {
    const result = parseJson<FieldChangeInput>(value);
    if (isErr(result)) {
      return err(
        createError("invalid-json-format", "Invalid JSON format", {
          patch: fieldChange,
        }),
      );
    }
    return ok(result.data);
  }

  if (operator === "=") {
    if (value === "[]") return ok([]);

    const quotedValue = parseQuotedValue(value);
    if (quotedValue !== value) {
      if (quotedValue === "") return ok("");
      if (quotedValue === "true") return ok(true);
      if (quotedValue === "false") return ok(false);
      if (/^-?\d+$/.test(quotedValue)) return ok(parseInt(quotedValue, 10));
      if (/^-?\d+\.\d+$/.test(quotedValue)) return ok(parseFloat(quotedValue));
      return ok(quotedValue);
    }

    if (value === "") return ok("");
    if (value.includes(",")) {
      return ok(splitCommaSeparated(value));
    }

    if (value === "true") return ok(true);
    if (value === "false") return ok(false);
    if (/^-?\d+$/.test(value)) return ok(parseInt(value, 10));
    if (/^-?\d+\.\d+$/.test(value)) return ok(parseFloat(value));
    return ok(value);
  }

  if (operator === "+=") {
    const values = splitCommaSeparated(value);
    const normalizedIndexResult = normalizeIndex(index);
    if (isErr(normalizedIndexResult)) return normalizedIndexResult;
    const normalizedIndex = normalizedIndexResult.data;

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (normalizedIndex === undefined) {
        return ok(["insert", val]);
      }
      return ok(["insert", val, normalizedIndex]);
    }

    return ok(
      values.map((v) => {
        const val = parseSimpleValue(v);
        if (normalizedIndex === undefined) {
          return ["insert", val];
        }
        return ["insert", val, normalizedIndex];
      }),
    );
  }

  if (operator === "-=") {
    const values = splitCommaSeparated(value);
    const normalizedIndexResult = normalizeIndex(index);
    if (isErr(normalizedIndexResult)) return normalizedIndexResult;
    const normalizedIndex = normalizedIndexResult.data;

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (normalizedIndex === undefined) {
        return ok(["remove", val]);
      }
      return ok(["remove", val, normalizedIndex]);
    }

    return ok(
      values.map((v) => {
        const val = parseSimpleValue(v);
        if (normalizedIndex === undefined) {
          return ["remove", val];
        }
        return ["remove", val, normalizedIndex];
      }),
    );
  }

  if (operator === "--") {
    const normalizedIndexResult = normalizeIndex(index);
    if (isErr(normalizedIndexResult)) return normalizedIndexResult;
    const normalizedIndex = normalizedIndexResult.data;
    if (normalizedIndex === undefined) {
      return err(
        createError("missing-index", "Remove by position requires an index", {
          patch: fieldChange,
        }),
      );
    }
    return ok(["remove", null, normalizedIndex]);
  }

  return err(
    createError("invalid-operator", "Invalid operator", {
      operator,
      patch: fieldChange,
    }),
  );
};

export const parsePatches = (
  patches: string[],
): Result<FieldChangesetInput> => {
  const result: Record<string, FieldChangeInput> = {};
  for (const patch of patches) {
    const arrayOp = parseArrayOperation(patch);
    if (!arrayOp) return err(createPatchFormatError(patch));

    const fieldKey = arrayOp.field as FieldKey;
    const fieldChangeResult = parseFieldChange(patch);
    if (isErr(fieldChangeResult)) return fieldChangeResult;
    result[fieldKey] = fieldChangeResult.data;
  }
  return ok(result);
};

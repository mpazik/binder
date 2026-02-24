import {
  type EntitySchema,
  type FieldChangeInput,
  type FieldChangesetInput,
  type FieldDef,
  type FieldKey,
  type Fieldset,
  getMultiValueDelimiter,
  isListMutationInput,
  isListMutationInputArray,
  parseFieldValue,
  splitByDelimiter,
} from "@binder/db";
import {
  createError,
  err,
  type ErrorObject,
  fail,
  isErr,
  ok,
  type Result,
  tryCatch,
} from "@binder/utils";
import * as YAML from "yaml";

export const patchesDescription = "field=value patches";

export const createPatchExamples = (
  command: string,
): readonly [string, string][] => [
  [`$0 ${command} title=Hello`, "Set field"],
  [`$0 ${command} tags=a,b,c`, "Set array (comma-separated)"],
  [`$0 ${command} tags+=urgent`, "Append to array"],
  [`$0 ${command} tags-=old`, "Remove from array"],
  [`$0 ${command} tags:0+=first`, "Insert at position"],
  [`$0 ${command} tags:last--`, "Remove last"],
  [`$0 ${command} 'fields:title={required: true}'`, "Patch attrs"],
];

type PatchOperation = {
  field: string;
  accessor?: string;
  operator: "=" | "+=" | "-=" | "--";
  value: string;
};

const trimSingleQuotes = (str: string): string => {
  if (str.startsWith("'") && str.endsWith("'")) {
    return str.slice(1, -1);
  }
  return str;
};

const parsePatchOperation = (patch: string): PatchOperation | null => {
  const patchHasOuterQuotes =
    (patch.startsWith("'") && patch.endsWith("'")) ||
    (patch.startsWith('"') && patch.endsWith('"'));
  const trimmedPatch = patchHasOuterQuotes ? patch.slice(1, -1) : patch;
  const match = trimmedPatch.match(/^(\w+)(?::([^=+-]+))?([-+]*=|--)(.*)$/s);
  if (!match) return null;

  const [, field, accessor, operator, value] = match;
  return {
    field: field!,
    accessor: accessor,
    operator: operator as PatchOperation["operator"],
    value: trimSingleQuotes(value!),
  };
};

type NormalizedAccessor = number | "first" | "last" | string;

const normalizeAccessor = (
  accessor?: string,
): Result<NormalizedAccessor | undefined> => {
  if (accessor === undefined) return ok(undefined);
  if (accessor === "first") return ok("first");
  if (accessor === "last") return ok("last");
  const num = Number(accessor);
  if (!isNaN(num)) return ok(num);
  return ok(accessor);
};

const accessorToPosition = (
  accessor: NormalizedAccessor,
): number | "last" | undefined => {
  if (accessor === "first") return 0;
  if (accessor === "last") return "last";
  if (typeof accessor === "number") return accessor;
  return undefined;
};

const isStringAccessor = (accessor: NormalizedAccessor): accessor is string =>
  typeof accessor === "string" && accessor !== "first" && accessor !== "last";

const parseQuotedValue = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const splitForField = (value: string, fieldDef: FieldDef): string[] => {
  const quoted = parseQuotedValue(value);
  if (quoted !== value) {
    return [quoted];
  }
  const delimiter = getMultiValueDelimiter(fieldDef);
  return splitByDelimiter(value, delimiter).filter((item) => item.length > 0);
};

const parseSimpleValue = (value: string): string => {
  return value;
};

const createPatchFormatError = (patch: string): ErrorObject => {
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

const parseYamlValue = (
  value: string,
  patch: string,
): Result<FieldChangeInput> =>
  tryCatch(
    () => YAML.parse(value) as FieldChangeInput,
    (error) =>
      createError("invalid-yaml-format", "Invalid YAML/JSON format", {
        patch,
        error,
      }),
  );

export const parseFieldChange = (
  fieldChange: string,
  fieldDef: FieldDef,
): Result<FieldChangeInput> => {
  const patchOp = parsePatchOperation(fieldChange);
  if (!patchOp) return err(createPatchFormatError(fieldChange));

  const { accessor, operator, value } = patchOp;

  const normalizedAccessorResult = normalizeAccessor(accessor);
  if (isErr(normalizedAccessorResult)) return normalizedAccessorResult;
  const normalizedAccessor = normalizedAccessorResult.data;

  if (value.startsWith("[") || value.startsWith("{")) {
    const parsedResult = parseYamlValue(value, fieldChange);
    if (isErr(parsedResult)) return parsedResult;
    const parsedValue = parsedResult.data;

    if (
      normalizedAccessor !== undefined &&
      isStringAccessor(normalizedAccessor)
    ) {
      return ok(["patch", normalizedAccessor, parsedValue as Fieldset]);
    }

    return ok(parsedValue);
  }

  if (operator === "=") {
    if (value === "[]") return ok([]);
    return parseFieldValue(parseQuotedValue(value), fieldDef);
  }

  if (operator === "+=") {
    const position =
      normalizedAccessor !== undefined
        ? accessorToPosition(normalizedAccessor)
        : undefined;

    const values = splitForField(value, fieldDef);

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (position === undefined) {
        return ok(["insert", val]);
      }
      return ok(["insert", val, position]);
    }

    return ok(
      values.map((v) => {
        const val = parseSimpleValue(v);
        if (position === undefined) {
          return ["insert", val];
        }
        return ["insert", val, position];
      }),
    );
  }

  if (operator === "-=") {
    const position =
      normalizedAccessor !== undefined
        ? accessorToPosition(normalizedAccessor)
        : undefined;

    const values = splitForField(value, fieldDef);

    if (values.length === 1) {
      const val = parseSimpleValue(values[0]!);
      if (position === undefined) {
        return ok(["remove", val]);
      }
      return ok(["remove", val, position]);
    }

    return ok(
      values.map((v) => {
        const val = parseSimpleValue(v);
        if (position === undefined) {
          return ["remove", val];
        }
        return ["remove", val, position];
      }),
    );
  }

  if (operator === "--") {
    const position =
      normalizedAccessor !== undefined
        ? accessorToPosition(normalizedAccessor)
        : undefined;

    if (position === undefined) {
      return fail(
        "missing-accessor",
        "Remove by position requires an accessor (e.g., :0, :first, :last)",
        {
          patch: fieldChange,
        },
      );
    }
    return ok(["remove", null, position]);
  }

  return fail("invalid-operator", "Invalid operator", {
    operator,
    patch: fieldChange,
  });
};

const toMutationArray = (
  input: FieldChangeInput,
): FieldChangeInput[] | undefined => {
  if (isListMutationInputArray(input)) return input;
  if (isListMutationInput(input)) return [input];
  return undefined;
};

const mergeMutations = (
  existing: FieldChangeInput,
  incoming: FieldChangeInput,
): FieldChangeInput => {
  const existingOps = toMutationArray(existing)!;
  const incomingOps = toMutationArray(incoming)!;
  return [...existingOps, ...incomingOps] as FieldChangeInput;
};

export const parsePatches = (
  patches: string[],
  schema: EntitySchema,
): Result<FieldChangesetInput> => {
  const result: Record<string, FieldChangeInput> = {};
  const operators: Record<string, string> = {};
  for (const patch of patches) {
    const patchOp = parsePatchOperation(patch);
    if (!patchOp) return err(createPatchFormatError(patch));

    const fieldKey = patchOp.field as FieldKey;
    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef)
      return fail("field-not-found", `Unknown field: ${fieldKey}`, {
        field: fieldKey,
      });

    const fieldChangeResult = parseFieldChange(patch, fieldDef);
    if (isErr(fieldChangeResult)) return fieldChangeResult;

    const existing = result[fieldKey];
    if (existing !== undefined) {
      const prevOp = operators[fieldKey]!;
      const isMutationOp =
        patchOp.operator === "+=" || patchOp.operator === "-=";
      const wasMutationOp = prevOp === "+=" || prevOp === "-=";

      if (!isMutationOp || !wasMutationOp) {
        return fail(
          "duplicate-field-patch",
          `Field '${fieldKey}' has conflicting patches. Use a single patch per field, or combine mutations (+=, -=)`,
          { field: fieldKey },
        );
      }

      result[fieldKey] = mergeMutations(existing, fieldChangeResult.data);
    } else {
      result[fieldKey] = fieldChangeResult.data;
    }
    operators[fieldKey] = patchOp.operator;
  }
  return ok(result);
};

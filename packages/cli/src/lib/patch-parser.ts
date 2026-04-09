import {
  type EntitySchema,
  type FieldChangeInput,
  type FieldChangesetInput,
  type FieldDef,
  type FieldKey,
  type Fieldset,
  type MultiValueDelimiter,
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

export const patchesDescription =
  "field patches (set =, append +=, remove -=, remove by position --)";

export const createPatchExamples = (
  command: string,
): readonly [string, string][] => [
  [`$0 ${command} title=Hello`, "Set field"],
  [
    `$0 ${command} sourceFiles=$'a\\nb\\nc'`,
    "Set multi-value field (line-style formats)",
  ],
  [
    `$0 ${command} content=$'first block\\n\\nsecond block'`,
    "Set multi-value field (block-style formats)",
  ],
  [`$0 ${command} tags+=urgent`, "Append value"],
  [`$0 ${command} tags-=old`, "Remove matching value"],
  [`$0 ${command} tags:0+=first`, "Insert at position"],
  [`$0 ${command} tags:last--`, "Remove by position"],
  [`$0 ${command} 'fields:title={required: true}'`, "Patch attrs"],
];

type PatchOperation = {
  field: string;
  accessor?: string;
  operator: "=" | "+=" | "-=" | "--";
  value: string;
};

const trimSingleQuotes = (str: string): string => {
  if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
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
    accessor,
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
  )
    return value.slice(1, -1);
  return value;
};

// Override display delimiters for CLI input (e.g. comma instead of newline for filepaths)
const inputDelimiterOverride: Partial<Record<string, MultiValueDelimiter>> = {
  filepath: "comma",
};

const getInputDelimiter = (fieldDef: FieldDef): MultiValueDelimiter => {
  if (fieldDef.dataType === "plaintext" && fieldDef.plaintextFormat) {
    const override = inputDelimiterOverride[fieldDef.plaintextFormat];
    if (override) return override;
  }
  return getMultiValueDelimiter(fieldDef);
};

const splitForField = (value: string, fieldDef: FieldDef): string[] => {
  const quoted = parseQuotedValue(value);
  if (quoted !== value) {
    return [quoted];
  }
  const delimiter = getInputDelimiter(fieldDef);
  return splitByDelimiter(value, delimiter, fieldDef.sectionDepth).filter(
    (item) => item.length > 0,
  );
};

const createPatchFormatError = (patch: string): ErrorObject => {
  const missingOperator = !patch.includes("=");
  const hasQuote = patch.includes('"') || patch.includes("'");

  if (missingOperator && hasQuote) {
    return createError(
      "invalid-patch-format",
      "Invalid patch format. If your value contains spaces, quote the entire patch: 'field=value with spaces'",
      { data: { patch } },
    );
  }

  return createError("invalid-patch-format", "Invalid patch format", {
    data: { patch },
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
        data: { patch, error },
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
    const inputDelimiter = getInputDelimiter(fieldDef);
    const storageDelimiter = getMultiValueDelimiter(fieldDef);
    if (fieldDef.allowMultiple && inputDelimiter !== storageDelimiter) {
      const parsed = parseQuotedValue(value);
      if (parsed !== value) return ok([parsed]);
      const items = splitByDelimiter(parsed, inputDelimiter).filter(
        (item) => item.length > 0,
      );
      return ok(items);
    }
    return parseFieldValue(parseQuotedValue(value), fieldDef);
  }

  if (operator === "+=" || operator === "-=") {
    const action = operator === "+=" ? "insert" : "remove";
    const position =
      normalizedAccessor !== undefined
        ? accessorToPosition(normalizedAccessor)
        : undefined;

    const values = splitForField(value, fieldDef);

    const toMutation = (v: string) =>
      position === undefined ? [action, v] : [action, v, position];

    if (values.length === 1) return ok(toMutation(values[0]!));

    return ok(values.map(toMutation));
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
          data: { patch: fieldChange },
        },
      );
    }
    return ok(["remove", null, position]);
  }

  return fail("invalid-operator", "Invalid operator", {
    data: { operator, patch: fieldChange },
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

// Matches any patch operation: field=val, field+=val, field-=val, field:pos--
const isPatch = (s: string): boolean =>
  /^\w+(?::[^\s=]+)?(?:[-+]*=|--)/.test(s);

const CREATE_USAGE = "binder create <type> [key] [field=value ...]";

export type CreatePatchesResult = {
  /** Resolved entity type */
  type: string;
  /** Normalized field patches ready to pass to parsePatches */
  fieldPatches: string[];
};

/**
 * Parses raw positional args from the create command into a type and field patches.
 *
 * Positional grammar:
 *   [type] [key] [field=value ...]  — leading non-patch items are type then key
 *   [field=value ...]               — all patches; type must be given as type=X
 *
 * Errors on: missing type, extra positionals, duplicate type/key across both forms.
 */
export const parseCreatePatches = (
  patches: string[],
): Result<CreatePatchesResult> => {
  let type: string | undefined;
  let key: string | undefined;
  let startIdx = 0;

  if (patches.length > 0 && !isPatch(patches[0]!)) {
    type = patches[0];
    startIdx = 1;

    if (patches.length > 1 && !isPatch(patches[1]!)) {
      key = patches[1];
      startIdx = 2;
    }
  }

  // All items from startIdx onward must be patches
  const fieldPatches = patches.slice(startIdx);
  for (const item of fieldPatches) {
    if (!isPatch(item))
      return fail(
        "extra-positionals",
        `Unexpected positional '${item}'. Usage: ${CREATE_USAGE}`,
      );
  }

  // Conflict: type given both as positional and as type=X patch
  if (type !== undefined) {
    const conflict = fieldPatches.find((p) => /^type=/.test(p));
    if (conflict)
      return fail(
        "duplicate-type",
        `Type given twice: as positional '${type}' and as patch '${conflict}'.`,
      );
  }

  // Conflict: key given both as positional and as key=X patch
  if (key !== undefined) {
    const conflict = fieldPatches.find((p) => /^key=/.test(p));
    if (conflict)
      return fail(
        "duplicate-key",
        `Key given twice: as positional '${key}' and as patch '${conflict}'.`,
      );
  }

  // Extract type from type=X patch when not given as a positional
  let remainingPatches = fieldPatches;
  if (type === undefined) {
    const typeIdx = remainingPatches.findIndex((p) => /^type=(.+)$/s.test(p));
    if (typeIdx >= 0) {
      type = remainingPatches[typeIdx]!.match(/^type=(.+)$/s)![1];
      remainingPatches = remainingPatches.filter((_, i) => i !== typeIdx);
    }
  }

  if (!type)
    return fail("missing-type", `Provide a type. Usage: ${CREATE_USAGE}`);

  // Positional key becomes a regular key=X patch
  if (key !== undefined) remainingPatches = [...remainingPatches, `key=${key}`];

  return ok({ type, fieldPatches: remainingPatches });
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
        data: { field: fieldKey },
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
          { data: { field: fieldKey } },
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

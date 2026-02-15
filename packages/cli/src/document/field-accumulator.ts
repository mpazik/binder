import {
  type FieldNestedValue,
  type FieldPath,
  type FieldsetNested,
  type FieldValue,
  getNestedValue,
  isFieldsetNested,
  setNestedValue,
} from "@binder/db";
import {
  createError,
  type ErrorObject,
  isEqual,
  ok,
  err,
  type Result,
} from "@binder/utils";

export type FieldConflictSource = {
  file?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  origin?: "frontmatter" | "body" | "body:duplicate";
};

export type FieldConflictData = {
  fieldPath: FieldPath;
  values: Array<{
    value: FieldValue;
    source?: FieldConflictSource;
  }>;
  baseValue: FieldValue;
};

export type FieldConflictError = ErrorObject<FieldConflictData>;

type StoredField = {
  value: FieldValue;
  source?: FieldConflictSource;
};

export type FieldAccumulator = {
  set: (
    fieldPath: FieldPath,
    value: FieldValue,
    source?: FieldConflictSource,
  ) => void;
  result: () => Result<FieldsetNested, FieldConflictError>;
};

const fieldPathKey = (path: FieldPath): string => path.join(".");

export const createFieldAccumulator = (
  base: FieldsetNested,
): FieldAccumulator => {
  const stored = new Map<string, StoredField>();
  const conflicts: FieldConflictError[] = [];

  return {
    set: (
      fieldPath: FieldPath,
      value: FieldValue,
      source?: FieldConflictSource,
    ): void => {
      const baseValue = getNestedValue(base, fieldPath);
      const key = fieldPathKey(fieldPath);

      if (isEqual(value, baseValue)) return;

      const existing = stored.get(key);

      if (!existing) {
        stored.set(key, { value, source });
        return;
      }

      if (isEqual(existing.value, value)) return;

      conflicts.push(
        createError("field-conflict", `Conflicting values for field '${key}'`, {
          fieldPath,
          values: [
            { value: existing.value, source: existing.source },
            { value, source },
          ],
          baseValue: baseValue as FieldValue,
        }),
      );
    },

    result: (): Result<FieldsetNested, FieldConflictError> => {
      if (conflicts.length > 0) return err(conflicts[0]!);

      const fieldset: FieldsetNested = {};
      // Sort shorter paths first so parent objects are set before nested paths
      const entries = [...stored.entries()].sort(
        (a, b) => a[0].split(".").length - b[0].split(".").length,
      );

      for (const [key, { value }] of entries) {
        const path = key.split(".");

        // When setting an object value, merge with any nested values
        // already placed at that path by longer-path entries
        if (isFieldsetNested(value)) {
          const existing = getNestedValue(fieldset, path) as
            | FieldNestedValue
            | undefined;
          if (existing !== undefined && isFieldsetNested(existing)) {
            setNestedValue(fieldset, path, {
              ...(value as FieldsetNested),
              ...(existing as FieldsetNested),
            });
            continue;
          }
        }

        setNestedValue(fieldset, path, value);
      }

      return ok(fieldset);
    },
  };
};

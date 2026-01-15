import { z } from "zod";
import {
  assertFailed,
  isObjTuple,
  objEntries,
  type ObjTuple,
  objTupleKey,
  objTupleToTuple,
  omit,
} from "@binder/utils";
import {
  type FieldKey,
  type Fieldset,
  type FieldValue,
  getMultiValueDelimiter,
  splitByDelimiter,
} from "./field.ts";
import type {
  EntityNsKey,
  EntityNsRef,
  EntityNsType,
  NamespaceEditable,
  NamespaceSchema,
} from "./namespace.ts";
import {
  type FieldChangeset,
  isValueChange,
  type ListMutation,
  type ListMutationInsert,
  type ListMutationPatch,
  type ListMutationRemove,
  type ValueChange,
} from "./changeset.ts";
import type { OptionDef } from "./data-type.ts";
import type { FieldDef } from "./schema.ts";

// Input mutation types - accept ObjTuple for ergonomic YAML/CLI input
// These get normalized to internal ListMutation types during processing

export type ListMutationInputValue = FieldValue | ObjTuple<string, Fieldset>;

export type ListMutationInputInsert = [
  kind: "insert",
  value: ListMutationInputValue,
  position?: number,
];
export type ListMutationInputRemove = [
  kind: "remove",
  value: ListMutationInputValue,
  position?: number,
];
export type ListMutationInputPatch = [
  kind: "patch",
  ref: string,
  attrs: Fieldset,
];

export type ListMutationInput =
  | ListMutationInputInsert
  | ListMutationInputRemove
  | ListMutationInputPatch;

export const isListMutationInput = (
  input: FieldChangeInput,
): input is ListMutationInput =>
  Array.isArray(input) &&
  input.length >= 2 &&
  input.length <= 3 &&
  (input[0] === "insert" || input[0] === "remove" || input[0] === "patch");

export const isListMutationInputArray = (
  input: FieldChangeInput,
): input is ListMutationInput[] =>
  Array.isArray(input) &&
  input.length > 0 &&
  input.every(
    (item) =>
      item !== undefined &&
      isListMutationInput(item as unknown as FieldChangeInput),
  );

export type FieldChangeInput =
  | FieldValue
  | ListMutationInput
  | ListMutationInput[];
export type FieldChangesetInput = Record<FieldKey, FieldChangeInput>;
export type EntityUpdate<N extends NamespaceEditable> = FieldChangesetInput & {
  $ref: EntityNsRef[N];
};
export type EntityCreate<N extends NamespaceEditable> = FieldChangesetInput & {
  type: EntityNsType[N];
  key?: EntityNsKey[N];
};
export type EntityChangesetInput<N extends NamespaceEditable> =
  | EntityUpdate<N>
  | EntityCreate<N>;

export type ChangesetsInput<N extends NamespaceEditable = NamespaceEditable> =
  EntityChangesetInput<N>[];

export const changesetInputForNewEntity = <N extends NamespaceEditable>(
  entity: Fieldset,
): EntityChangesetInput<N> => omit(entity, ["id"]) as EntityChangesetInput<N>;

export const isEntityUpdate = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
): input is EntityUpdate<N> => "$ref" in input;

export const getMutationInputRef = (value: ListMutationInputValue): string =>
  isObjTuple(value) ? objTupleKey(value) : (value as string);

export const normalizeInputValue = (value: FieldValue): FieldValue =>
  Array.isArray(value)
    ? value.map(normalizeItemInputValue)
    : normalizeItemInputValue(value);

const normalizeItemInputValue = (value: ListMutationInputValue): FieldValue =>
  isObjTuple(value) ? objTupleToTuple(value) : value;

const normalizeInsertMutation = (
  input: ListMutationInputInsert,
): ListMutationInsert => [
  "insert",
  normalizeItemInputValue(input[1]),
  input[2],
];

const normalizeRemoveMutation = (
  input: ListMutationInputRemove,
): ListMutationRemove => [
  "remove",
  normalizeItemInputValue(input[1]),
  input[2],
];

const normalizePatchMutation = (
  input: ListMutationInputPatch,
): ListMutationPatch => [
  "patch",
  input[1],
  normalizeFieldChangesetInput(input[2]),
];

export const normalizeListMutationInput = (
  input: ListMutationInput,
): ListMutation => {
  switch (input[0]) {
    case "insert":
      return normalizeInsertMutation(input);
    case "remove":
      return normalizeRemoveMutation(input);
    case "patch":
      return normalizePatchMutation(input);
  }
};

export const normalizeFieldChangesetInput = (
  input: FieldChangesetInput,
): FieldChangeset => {
  const result: FieldChangeset = {};
  for (const [key, value] of Object.entries(input)) {
    if (isListMutationInputArray(value)) {
      result[key] = ["seq", value.map(normalizeListMutationInput)];
    } else if (isListMutationInput(value)) {
      result[key] = ["seq", [normalizeListMutationInput(value)]];
    } else {
      result[key] = normalizeInputValue(value as FieldValue);
    }
  }
  return result;
};

export type OptionDefInput = string | OptionDef;

export const normalizeOptionDef = (item: OptionDefInput): OptionDef =>
  typeof item === "string" ? { key: item } : item;

export const normalizeOptionSet = (options: OptionDefInput[]): OptionDef[] =>
  options.map(normalizeOptionDef);

const normalizeFieldValue = (
  fieldDef: FieldDef | undefined,
  value: FieldValue,
): FieldValue | ListMutation | ListMutation[] => {
  if (isListMutationInputArray(value)) {
    return (value as ListMutationInput[]).map(normalizeListMutationInput);
  }
  if (isListMutationInput(value)) {
    return normalizeListMutationInput(value as ListMutationInput);
  }
  if (fieldDef?.dataType === "optionSet" && Array.isArray(value)) {
    return normalizeOptionSet(value as OptionDefInput[]);
  }
  if (fieldDef?.dataType === "relation") {
    return normalizeInputValue(value);
  }
  if (fieldDef?.allowMultiple && !Array.isArray(value)) {
    // For text fields, split by the appropriate delimiter
    if (
      typeof value === "string" &&
      (fieldDef.dataType === "plaintext" || fieldDef.dataType === "richtext")
    ) {
      const delimiter = getMultiValueDelimiter(fieldDef);
      return splitByDelimiter(value, delimiter).filter(
        (item) => item.length > 0,
      );
    }
    return [value];
  }
  return value;
};

export const normalizeInput = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
  schema: NamespaceSchema<N>,
): EntityChangesetInput<N> => {
  const normalized: EntityChangesetInput<N> = { ...input };

  for (const [fieldKey, value] of objEntries(input)) {
    if (fieldKey === "$ref" || fieldKey === "type" || value === undefined)
      continue;

    const fieldDef = schema.fields[fieldKey];
    normalized[fieldKey] = normalizeFieldValue(
      fieldDef,
      value as FieldValue,
    ) as typeof value;
  }

  return normalized;
};

const valueChangeToInput = (change: ValueChange): FieldChangeInput => {
  if (change[0] === "set") return change[1];
  if (change[0] === "clear") return null;
  if (change[0] === "seq")
    return change[1].map((m: ListMutation) =>
      m[0] === "patch"
        ? ([m[0], m[1], changesetToInput(m[2])] as ListMutationInput)
        : m,
    );
  if (change[0] === "patch") return changesetToInput(change[1]) as FieldValue;
  assertFailed("Unknown change kind");
};

export const changesetToInput = (
  changeset: FieldChangeset,
): FieldChangesetInput => {
  const result: FieldChangesetInput = {};
  for (const [key, value] of Object.entries(changeset)) {
    if (key === "id") continue;
    result[key] = isValueChange(value)
      ? valueChangeToInput(value)
      : (value as FieldChangeInput);
  }
  return result;
};

export const EntityCreateInputSchema = z
  .object({ type: z.string(), key: z.string().optional() })
  .passthrough()
  .transform((val) => val as EntityCreate<NamespaceEditable>);

export const EntityUpdateInputSchema = z
  .object({ $ref: z.string() })
  .passthrough()
  .transform((val) => val as EntityUpdate<NamespaceEditable>);

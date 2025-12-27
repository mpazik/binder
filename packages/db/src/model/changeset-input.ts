import {
  isObjTuple,
  objTupleKey,
  objTupleToTuple,
  omit,
  type ObjTuple,
} from "@binder/utils";
import { type FieldKey, type Fieldset, type FieldValue } from "./field.ts";
import type {
  EntityNsKey,
  EntityNsRef,
  EntityNsType,
  NamespaceEditable,
} from "./namespace.ts";
import type {
  FieldChangeset,
  ListMutation,
  ListMutationInsert,
  ListMutationPatch,
  ListMutationRemove,
} from "./changeset.ts";
import type { OptionDef } from "./data-type.ts";

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
    ? value.map(normalizeListInputValue)
    : normalizeListInputValue(value);

const normalizeListInputValue = (value: ListMutationInputValue): FieldValue =>
  isObjTuple(value) ? objTupleToTuple(value) : value;

const normalizeInsertMutation = (
  input: ListMutationInputInsert,
): ListMutationInsert => [
  "insert",
  normalizeListInputValue(input[1]),
  input[2],
];

const normalizeRemoveMutation = (
  input: ListMutationInputRemove,
): ListMutationRemove => [
  "remove",
  normalizeListInputValue(input[1]),
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

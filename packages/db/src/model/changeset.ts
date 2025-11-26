import {
  assertEqual,
  assertFailed,
  assertType,
  assertUndefined,
  filterObjectValues,
  isEqual,
  mapObjectValues,
  omit,
} from "@binder/utils";
import type {
  EntityNsKey,
  EntityNsRef,
  EntityNsType,
  NamespaceEditable,
} from "./namespace.ts";
import type { NodeUid } from "./node.ts";
import type { ConfigKey } from "./config.ts";
import {
  type FieldKey,
  type Fieldset,
  type FieldValue,
  systemFields,
} from "./field.ts";

export type ListMutation =
  | [kind: "insert", inserted: FieldValue, position?: number]
  | [kind: "remove", removed: FieldValue, position?: number];

export type ValueChange =
  | {
      op: "set";
      value?: FieldValue;
      previous?: FieldValue;
    }
  | {
      op: "seq";
      mutations: ListMutation[];
    };

export type FieldChangeset = Record<FieldKey, ValueChange | FieldValue>;
export const emptyChangeset: FieldChangeset = {};
export type EntityChangesetRef<N extends NamespaceEditable> = N extends "node"
  ? NodeUid
  : ConfigKey;
export type EntitiesChangeset<N extends NamespaceEditable = "node" | "config"> =
  Record<EntityChangesetRef<N>, FieldChangeset>; // assumption is that order or entity change application does not matter
export type NodesChangeset = EntitiesChangeset<"node">;
export type ConfigurationsChangeset = EntitiesChangeset<"config">;

export const isValueChange = (
  value: ValueChange | FieldValue,
): value is ValueChange =>
  typeof value === "object" && value !== null && "op" in value;

export const normalizeValueChange = (
  change: ValueChange | FieldValue,
): ValueChange =>
  isValueChange(change) ? change : { op: "set", value: change };

export const compactValueChange = (
  change: ValueChange,
): ValueChange | FieldValue =>
  change.op === "set" && change.previous === undefined ? change.value! : change;

export const inverseChange = (change: ValueChange): ValueChange => {
  switch (change.op) {
    case "set":
      return { op: "set", value: change.previous, previous: change.value };
    case "seq": {
      // Reverse the order of mutations and invert each one
      const invertedMutations = change.mutations
        .slice()
        .reverse()
        .map((mutation): ListMutation => {
          const [kind, value, position] = mutation;
          if (kind === "insert") {
            return ["remove", value, position];
          }
          if (kind === "remove") {
            return ["insert", value, position];
          }
          assertFailed("Unknown mutation kind");
        });
      return { op: "seq", mutations: invertedMutations };
    }
  }
};

export const inverseChangeset = (changeset: FieldChangeset): FieldChangeset =>
  mapObjectValues(changeset, (value) =>
    compactValueChange(inverseChange(normalizeValueChange(value))),
  ) as FieldChangeset;

const rebaseChange = (
  baseChange: ValueChange,
  change: ValueChange,
): ValueChange => {
  if (baseChange.op === "set") {
    if (change.op !== "set") {
      return change;
    }

    if (isEqual(change.previous, baseChange.value)) {
      return change;
    }

    if (isEqual(change.previous, baseChange.previous)) {
      return {
        op: "set",
        previous: baseChange.value,
        value: change.value,
      } satisfies ValueChange;
    }

    assertFailed(
      "Cannot rebase set change. Incoming change is not based on the latest value.",
    );
  }

  if (baseChange.op === "seq" && change.op === "seq") {
    // Rebase sequence mutations by applying base mutations first, then adjusting change mutations
    const rebasedMutations = change.mutations.map((mutation) => {
      if (mutation[2] === undefined) {
        return mutation;
      }

      let adjustedPosition = mutation[2];

      // Apply position adjustments based on base mutations that occur before this position
      for (const baseMutation of baseChange.mutations) {
        const [kind, _, position] = baseMutation;
        if (position === undefined) continue;

        if (kind === "insert" && position <= adjustedPosition) {
          adjustedPosition++;
        } else if (kind === "remove" && position < adjustedPosition) {
          adjustedPosition--;
        } else if (position === adjustedPosition) {
          // Conflict: both base and change operate on the same position
          const mutKind = mutation[0];
          if (kind === "remove" && mutKind === "remove") {
            assertFailed(
              `Cannot rebase remove operation at position ${adjustedPosition}: both base and change remove from the same position`,
            );
          }
          // For add vs add or add vs remove, we might allow it, but for now, let's be strict
          if (kind === mutKind) {
            assertFailed(
              `Cannot rebase ${mutKind} operation at position ${adjustedPosition}: conflicting operations at the same position`,
            );
          }
        }
      }

      const [kind, value] = mutation;
      return [kind, value, adjustedPosition] as ListMutation;
    });

    return { op: "seq", mutations: rebasedMutations };
  }

  return change;
};

export const rebaseChangeset = (
  base: FieldChangeset,
  changeset: FieldChangeset,
): FieldChangeset => {
  return Object.entries(changeset).reduce(
    (acc, [attributeKey, change]) => {
      const key = attributeKey as FieldKey;
      const baseChange = base[key];
      const normalizedChange = normalizeValueChange(change);

      acc[key] = baseChange
        ? rebaseChange(normalizeValueChange(baseChange), normalizedChange)
        : normalizedChange;

      return acc;
    },
    {} as Record<FieldKey, ValueChange>,
  );
};

export const applyChange = (
  current: FieldValue,
  change: ValueChange,
): FieldValue => {
  switch (change.op) {
    case "set": {
      if (current === null || current === undefined) {
        assertUndefined(change.previous, "change.previous");
      } else {
        assertEqual(current, change.previous, "change field");
      }
      return change.value ?? null;
    }
    case "seq": {
      let result = current ?? [];
      for (const mutation of change.mutations) {
        const [mutKind, mutValue, mutPos] = mutation;
        if (mutKind === "insert") {
          assertType(
            result,
            (it): it is FieldValue[] => Array.isArray(it),
            "attribute",
          );
          const arr = [...result];
          const pos = mutPos ?? arr.length;
          if (isEqual(arr[pos], mutValue)) arr.splice(pos, 1);
          else arr.splice(pos, 0, mutValue);
          result = arr;
        } else if (mutKind === "remove") {
          assertType(
            result,
            (it): it is FieldValue[] => Array.isArray(it),
            "attribute",
          );
          const arr = [...result];
          const pos = mutPos ?? arr.length - 1;
          if (pos >= arr.length) {
            assertFailed(
              `Remove mutation position ${pos} is out of bounds for array of length ${arr.length}`,
            );
          }
          if (!isEqual(arr[pos], mutValue)) {
            assertFailed(
              `Remove mutation expected ${JSON.stringify(mutValue)} at position ${pos}, but found ${JSON.stringify(arr[pos])}`,
            );
          }
          arr.splice(pos, 1);
          result = arr;
        }
      }
      return Array.isArray(result) && result.length === 0 ? null : result;
    }
  }
};

export const applyChangeset = (
  fields: Fieldset,
  changeset: FieldChangeset,
): Fieldset => {
  const applied = {} as Fieldset;
  for (const [key, change] of Object.entries(changeset)) {
    applied[key as FieldKey] = applyChange(
      fields[key],
      normalizeValueChange(change),
    );
  }
  const result = { ...fields, ...applied };
  return filterObjectValues(result, (value, key) => {
    if (key in applied) {
      if (value === null) {
        const change = normalizeValueChange(changeset[key]);
        return change.op !== "seq";
      }
      return true;
    }
    return value !== null && !(Array.isArray(value) && value.length === 0);
  });
};

export const squashChange = (
  baseChange: ValueChange,
  change: ValueChange,
): ValueChange | null => {
  if (baseChange.op === "set" && change.op === "set") {
    if (change.value === baseChange.previous) {
      return null;
    }
    return { op: "set", value: change.value, previous: baseChange.previous };
  }

  if (baseChange.op === "set" && change.op === "seq") {
    const resultValue = applyChange(baseChange.value ?? null, change);
    return { op: "set", value: resultValue, previous: baseChange.previous };
  }

  if (baseChange.op === "seq" && change.op === "seq") {
    // Squash sequences by normalizing mutations
    const combinedMutations = [...baseChange.mutations];

    for (const nextMutation of change.mutations) {
      // First, check for direct cancellation without position adjustment
      let cancelled = false;
      const [nextKind, nextVal, nextPos] = nextMutation;
      if (nextKind === "remove") {
        const cancelIndex = combinedMutations.findIndex(
          ([kind, value, position]) =>
            kind === "insert" &&
            (position === nextPos ||
              (position === undefined && nextPos === undefined)) &&
            isEqual(value, nextVal),
        );

        if (cancelIndex !== -1) {
          // Store the position of the insert being removed before we remove it
          const removedInsertPos = combinedMutations[cancelIndex]![2];
          // Remove the cancelling add operation
          combinedMutations.splice(cancelIndex, 1);
          // Adjust positions of subsequent mutations based on the removed insert's position
          if (removedInsertPos !== undefined) {
            for (let i = cancelIndex; i < combinedMutations.length; i++) {
              const [kind, val, pos] = combinedMutations[i]!;
              if (pos !== undefined && pos > removedInsertPos) {
                combinedMutations[i] = [kind, val, pos - 1] as ListMutation;
              }
            }
          }
          cancelled = true;
        }
      }

      if (!cancelled) {
        if (nextPos === undefined) {
          combinedMutations.push(nextMutation);
        } else {
          // Adjust position based on prior mutations in the combined sequence
          let adjustedPosition = nextPos;
          for (let i = 0; i < combinedMutations.length; i++) {
            const [baseKind, _, basePos] = combinedMutations[i]!;
            if (basePos === undefined) continue;
            if (baseKind === "insert" && basePos <= adjustedPosition) {
              adjustedPosition++;
            } else if (baseKind === "remove" && basePos < adjustedPosition) {
              adjustedPosition--;
            }
          }

          // Add the mutation with adjusted position
          combinedMutations.push([nextKind, nextVal, adjustedPosition]);
        }
      }
    }

    return { op: "seq", mutations: combinedMutations };
  }

  assertFailed(`Cannot squash ${baseChange.op} and ${change.op} operations`);
};

const squashChangesets = (
  base: FieldChangeset,
  changeset: FieldChangeset,
): FieldChangeset => {
  const squashedChanges = { ...base };
  for (const [key, change] of Object.entries(changeset)) {
    const normalizedChange = normalizeValueChange(change);
    if (squashedChanges[key]) {
      const squashed = squashChange(
        normalizeValueChange(squashedChanges[key]),
        normalizedChange,
      );
      if (squashed === null) {
        delete squashedChanges[key];
      } else {
        squashedChanges[key] = squashed;
      }
    } else {
      squashedChanges[key] = normalizedChange;
    }
  }

  // Filter out attributes with empty mutation sequences
  return filterObjectValues(squashedChanges, (change) => {
    const normalized = normalizeValueChange(change);
    return !(normalized.op === "seq" && normalized.mutations.length === 0);
  });
};
export default squashChangesets;

export type FieldChangeInput = FieldValue | ListMutation | ListMutation[];
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

export type ChangesetsInput<N extends NamespaceEditable> =
  EntityChangesetInput<N>[];

export const changesetInputForNewEntity = <N extends NamespaceEditable>(
  entity: Fieldset,
): EntityChangesetInput<N> =>
  omit(entity, systemFields) as EntityChangesetInput<N>;

export const isEntityUpdate = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
): input is EntityUpdate<N> => "$ref" in input;

export const isListMutation = (
  input: FieldChangeInput,
): input is ListMutation =>
  Array.isArray(input) &&
  input.length >= 2 &&
  input.length <= 3 &&
  (input[0] === "insert" || input[0] === "remove");

export const isListMutationArray = (
  input: FieldChangeInput,
): input is ListMutation[] =>
  Array.isArray(input) &&
  input.length > 0 &&
  input.every((item) => item !== undefined && isListMutation(item));

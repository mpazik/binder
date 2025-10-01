import {
  assertEqual,
  assertFailed,
  assertType,
  assertUndefined,
  filterObjectValues,
  mapObjectValues,
  omit,
  pick,
} from "@binder/utils";
import type { FieldKey, Fieldset, FieldValue } from "./entity.ts";
import type {
  NamespaceEditable,
  EntityNsKey,
  EntityNsRef,
  EntityNsType,
  EntityNsUid,
} from "./namespace.ts";
import { mockTask1Node } from "./node.mock.ts";

export type ListMutation =
  | { kind: "insert"; value: FieldValue; position: number }
  | { kind: "remove"; removed: FieldValue; position: number };

export type ValueChange =
  | {
      op: "set";
      value?: FieldValue;
      previous?: FieldValue;
    }
  | {
      op: "sequence";
      mutations: ListMutation[];
    };

export type FieldChangeset = Record<FieldKey, ValueChange>;
export const emptyChangeset: FieldChangeset = {};
export type EntitiesChangeset<N extends NamespaceEditable> = Record<
  EntityNsUid[N],
  FieldChangeset
>; // assumption is that order or entity change application does not matter
export type NodesChangeset = EntitiesChangeset<"node">;
export type ConfigurationsChangeset = EntitiesChangeset<"config">;

const isEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
};

export const inverseChange = (change: ValueChange): ValueChange => {
  switch (change.op) {
    case "set":
      return { op: "set", value: change.previous, previous: change.value };
    case "sequence": {
      // Reverse the order of mutations and invert each one
      const invertedMutations = change.mutations
        .slice()
        .reverse()
        .map((mutation): ListMutation => {
          if (mutation.kind === "insert") {
            return {
              kind: "remove",
              removed: mutation.value,
              position: mutation.position,
            };
          }
          if (mutation.kind === "remove") {
            return {
              kind: "insert",
              value: mutation.removed,
              position: mutation.position,
            };
          }
          assertFailed("Unknown mutation kind");
        });
      return { op: "sequence", mutations: invertedMutations };
    }
  }
};

export const inverseChangeset = (changeset: FieldChangeset): FieldChangeset => {
  return mapObjectValues(changeset, (value) => inverseChange(value)) as Record<
    FieldKey,
    ValueChange
  >;
};

export const computeSequenceMutations = (
  oldArr: FieldValue[],
  newArr: FieldValue[],
): ListMutation[] => {
  const mutations: ListMutation[] = [];
  let i = 0;
  let j = 0;
  while (i < oldArr.length || j < newArr.length) {
    if (
      i < oldArr.length &&
      j < newArr.length &&
      isEqual(oldArr[i], newArr[j])
    ) {
      i++;
      j++;
    } else if (j < newArr.length) {
      mutations.push({ kind: "insert", value: newArr[j], position: i });
      j++;
    } else {
      mutations.push({ kind: "remove", removed: oldArr[i], position: i });
      i++;
    }
  }
  return mutations;
};

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

  if (baseChange.op === "sequence" && change.op === "sequence") {
    // Rebase sequence mutations by applying base mutations first, then adjusting change mutations
    const rebasedMutations = change.mutations.map((mutation) => {
      let adjustedPosition = mutation.position;

      // Apply position adjustments based on base mutations that occur before this position
      for (const baseMutation of baseChange.mutations) {
        if (
          baseMutation.kind === "insert" &&
          baseMutation.position <= adjustedPosition
        ) {
          adjustedPosition++;
        } else if (
          baseMutation.kind === "remove" &&
          baseMutation.position < adjustedPosition
        ) {
          adjustedPosition--;
        } else if (baseMutation.position === adjustedPosition) {
          // Conflict: both base and change operate on the same position
          if (baseMutation.kind === "remove" && mutation.kind === "remove") {
            assertFailed(
              `Cannot rebase remove operation at position ${adjustedPosition}: both base and change remove from the same position`,
            );
          }
          // For add vs add or add vs remove, we might allow it, but for now, let's be strict
          if (baseMutation.kind === mutation.kind) {
            assertFailed(
              `Cannot rebase ${mutation.kind} operation at position ${adjustedPosition}: conflicting operations at the same position`,
            );
          }
        }
      }

      return {
        ...mutation,
        position: adjustedPosition,
      };
    });

    return { op: "sequence", mutations: rebasedMutations };
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

      acc[key] = baseChange ? rebaseChange(baseChange, change) : change;

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
      if (current) {
        assertEqual(current, change.previous, "change field");
      } else {
        assertUndefined(change.previous);
      }
      return change.value ?? null;
    }
    case "sequence": {
      let result = current;
      for (const mutation of change.mutations) {
        if (mutation.kind === "insert") {
          assertType(
            result,
            (it): it is FieldValue[] => Array.isArray(it),
            "attribute",
          );
          const arr = [...result];
          if (isEqual(arr[mutation.position], mutation.value))
            arr.splice(mutation.position, 1);
          else arr.splice(mutation.position, 0, mutation.value);
          result = arr;
        } else if (mutation.kind === "remove") {
          assertType(
            result,
            (it): it is FieldValue[] => Array.isArray(it),
            "attribute",
          );
          const arr = [...result];
          if (mutation.position >= arr.length) {
            assertFailed(
              `Remove mutation position ${mutation.position} is out of bounds for array of length ${arr.length}`,
            );
          }
          if (!isEqual(arr[mutation.position], mutation.removed)) {
            assertFailed(
              `Remove mutation expected ${JSON.stringify(mutation.removed)} at position ${mutation.position}, but found ${JSON.stringify(arr[mutation.position])}`,
            );
          }
          arr.splice(mutation.position, 1);
          result = arr;
        }
      }
      return result;
    }
  }
};

export const applyChangeset = (
  fields: Fieldset,
  changeset: FieldChangeset,
): Fieldset => {
  const applied = {} as Fieldset;
  for (const [key, change] of Object.entries(changeset)) {
    applied[key as FieldKey] = applyChange(fields[key], change);
  }
  return { ...fields, ...applied };
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

  if (baseChange.op === "sequence" && change.op === "sequence") {
    // Squash sequences by normalizing mutations
    const combinedMutations = [...baseChange.mutations];

    for (const nextMutation of change.mutations) {
      // First, check for direct cancellation without position adjustment
      let cancelled = false;
      if (nextMutation.kind === "remove") {
        const cancelIndex = combinedMutations.findIndex(
          (m) =>
            m.kind === "insert" &&
            m.position === nextMutation.position &&
            isEqual(m.value, nextMutation.removed),
        );

        if (cancelIndex !== -1) {
          // Remove the cancelling add operation
          combinedMutations.splice(cancelIndex, 1);
          // Adjust positions of subsequent mutations
          for (let i = cancelIndex; i < combinedMutations.length; i++) {
            if (combinedMutations[i]!.position > nextMutation.position) {
              combinedMutations[i]!.position--;
            }
          }
          cancelled = true;
        }
      }

      if (!cancelled) {
        // Adjust position based on prior mutations in the combined sequence
        let adjustedPosition = nextMutation.position;
        for (let i = 0; i < combinedMutations.length; i++) {
          const baseMutation = combinedMutations[i]!;
          if (
            baseMutation.kind === "insert" &&
            baseMutation.position <= adjustedPosition
          ) {
            adjustedPosition++;
          } else if (
            baseMutation.kind === "remove" &&
            baseMutation.position < adjustedPosition
          ) {
            adjustedPosition--;
          }
        }

        // Add the mutation with adjusted position
        combinedMutations.push({
          ...nextMutation,
          position: adjustedPosition,
        });
      }
    }

    return { op: "sequence", mutations: combinedMutations };
  }

  assertFailed(`Cannot squash ${baseChange.op} and ${change.op} operations`);
};

const squashChangesets = (
  base: FieldChangeset,
  changeset: FieldChangeset,
): FieldChangeset => {
  const squashedChanges = { ...base };
  for (const [key, change] of Object.entries(changeset)) {
    if (squashedChanges[key]) {
      const squashed = squashChange(squashedChanges[key], change);
      if (squashed === null) {
        delete squashedChanges[key];
      } else {
        squashedChanges[key] = squashed;
      }
    } else {
      squashedChanges[key] = change;
    }
  }

  // Filter out attributes with empty mutation sequences
  return filterObjectValues(
    squashedChanges,
    (change) => !(change.op === "sequence" && change.mutations.length === 0),
  );
};
export default squashChangesets;

export const changesetForNewEntity = (fields: Fieldset): FieldChangeset => {
  return mapObjectValues(fields, (value) => ({
    op: "set",
    value,
  })) as FieldChangeset;
};

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
  omit(entity, [
    "id",
    "version",
    "createdAt",
    "updatedAt",
  ]) as EntityChangesetInput<N>;

export const isEntityUpdate = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
): input is EntityUpdate<N> => "$ref" in input;

export const isListMutation = (
  input: FieldChangeInput,
): input is ListMutation =>
  input != null &&
  typeof input === "object" &&
  "kind" in input &&
  ("insert" === input.kind || "remove" === input.kind);

export const isListMutationArray = (
  input: FieldChangeInput,
): input is ListMutation[] =>
  Array.isArray(input) && input.every((item) => isListMutation(item));

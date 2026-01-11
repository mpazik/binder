import {
  assert,
  assertEqual,
  assertFailed,
  assertInArrayRange,
  assertInRange,
  assertType,
  assertUndefined,
  filterObjectValues,
  isEqual,
  mapObjectValues,
  transformEntries,
} from "@binder/utils";
import type { NamespaceEditable, NamespaceSchema } from "./namespace.ts";
import type { NodeUid } from "./node.ts";
import type { ConfigKey } from "./config.ts";
import { type FieldKey, type Fieldset, type FieldValue } from "./field.ts";
import { type EntitySchema } from "./schema.ts";
import type { EntityKey } from "./entity.ts";

export type ListMutationInsert = [
  kind: "insert",
  value: FieldValue,
  position?: number,
];
export type ListMutationRemove = [
  kind: "remove",
  value: FieldValue,
  position?: number,
];
export type ListMutationPatch = [
  kind: "patch",
  ref: string,
  attrChangeset: FieldChangeset,
];

export type ListMutation =
  | ListMutationInsert
  | ListMutationRemove
  | ListMutationPatch;

export type ValueChangeSet =
  | [kind: "set", value: FieldValue, previous: FieldValue]
  | [kind: "set", value: FieldValue];
export type ValueChangeClear = [kind: "clear", previous: FieldValue];
export type ValueChangeSeq = [kind: "seq", mutations: ListMutation[]];
export type ValueChangePatch = [kind: "patch", attrChangeset: FieldChangeset];

export type ValueChange =
  | ValueChangeSet
  | ValueChangeClear
  | ValueChangeSeq
  | ValueChangePatch;

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
  Array.isArray(value) &&
  value.length >= 2 &&
  (value[0] === "set" ||
    value[0] === "clear" ||
    value[0] === "seq" ||
    value[0] === "patch");

export const isSetChange = (change: ValueChange): change is ValueChangeSet =>
  change[0] === "set";
export const isClearChange = (
  change: ValueChange,
): change is ValueChangeClear => change[0] === "clear";
export const isSeqChange = (change: ValueChange): change is ValueChangeSeq =>
  change[0] === "seq";
export const isPatchChange = (
  change: ValueChange,
): change is ValueChangePatch => change[0] === "patch";

const getSetPrevious = (change: ValueChangeSet): FieldValue | undefined =>
  change.length === 3 ? change[2] : undefined;

export const normalizeValueChange = (
  change: ValueChange | FieldValue,
): ValueChange => (isValueChange(change) ? change : ["set", change]);

export const compactValueChange = (
  change: ValueChange,
): ValueChange | FieldValue =>
  isSetChange(change) && change.length === 2 ? change[1] : change;

export const inverseMutation = (mutation: ListMutation): ListMutation => {
  if (isInsertMutation(mutation)) {
    const [, value, position] = mutation;
    return ["remove", value, position];
  }
  if (isRemoveMutation(mutation)) {
    const [, value, position] = mutation;
    return ["insert", value, position];
  }
  if (isPatchMutation(mutation)) {
    const [, ref, attrChangeset] = mutation;
    return ["patch", ref, inverseChangeset(attrChangeset)];
  }
  assertFailed("Unknown mutation kind");
};

export const inverseChange = (change: ValueChange): ValueChange => {
  if (isSetChange(change)) {
    const previous = getSetPrevious(change);
    const value = change[1];
    if (previous === undefined) return ["clear", value];
    return ["set", previous, value];
  }
  if (isClearChange(change)) {
    return ["set", change[1]];
  }
  if (isSeqChange(change)) {
    const invertedMutations = change[1].slice().reverse().map(inverseMutation);
    return ["seq", invertedMutations];
  }
  if (isPatchChange(change)) {
    return ["patch", inverseChangeset(change[1])];
  }
  assertFailed("Unknown change kind");
};

export const inverseChangeset = (changeset: FieldChangeset): FieldChangeset =>
  mapObjectValues(changeset, (value) =>
    compactValueChange(inverseChange(normalizeValueChange(value))),
  ) as FieldChangeset;

const rebasePositionalMutation = (
  mutation: ListMutationInsert | ListMutationRemove,
  baseMutations: ListMutation[],
): ListMutationInsert | ListMutationRemove => {
  const [kind, value, position] = mutation;
  if (position === undefined) return mutation;

  let adjustedPosition = position;

  for (const baseMutation of baseMutations) {
    if (isPatchMutation(baseMutation)) continue;

    const [baseKind, , basePos] = baseMutation;
    if (basePos === undefined) continue;

    if (baseKind === "insert" && basePos <= adjustedPosition) {
      adjustedPosition++;
    } else if (baseKind === "remove" && basePos < adjustedPosition) {
      adjustedPosition--;
    } else if (basePos === adjustedPosition) {
      if (baseKind === "remove" && kind === "remove") {
        assertFailed(
          `Cannot rebase remove operation at position ${adjustedPosition}: both base and change remove from the same position`,
        );
      }
      if (baseKind === kind) {
        assertFailed(
          `Cannot rebase ${kind} operation at position ${adjustedPosition}: conflicting operations at the same position`,
        );
      }
    }
  }

  return [kind, value, adjustedPosition];
};

const rebasePatchMutation = (
  mutation: ListMutationPatch,
  baseMutations: ListMutation[],
): ListMutationPatch => {
  const [, ref, attrChangeset] = mutation;

  const basePatchForSameRef = baseMutations.find(
    (m): m is ListMutationPatch => isPatchMutation(m) && m[1] === ref,
  );

  if (!basePatchForSameRef) return mutation;

  const rebasedAttrChangeset = rebaseChangeset(
    basePatchForSameRef[2],
    attrChangeset,
  );
  return ["patch", ref, rebasedAttrChangeset];
};

const rebaseChange = (
  baseChange: ValueChange,
  change: ValueChange,
): ValueChange => {
  if (isSetChange(baseChange) || isClearChange(baseChange)) {
    if (!isSetChange(change) && !isClearChange(change)) {
      return change;
    }

    const baseValue = isSetChange(baseChange) ? baseChange[1] : undefined;
    const basePrevious = isSetChange(baseChange)
      ? getSetPrevious(baseChange)
      : baseChange[1];
    const changePrevious = isSetChange(change)
      ? getSetPrevious(change)
      : change[1];
    const changeValue = isSetChange(change) ? change[1] : undefined;

    if (isEqual(changePrevious, baseValue)) {
      return change;
    }

    if (isEqual(changePrevious, basePrevious)) {
      if (changeValue === undefined) return ["clear", baseValue!];
      return ["set", changeValue, baseValue!];
    }

    assertFailed(
      "Cannot rebase set change. Incoming change is not based on the latest value.",
    );
  }

  if (isSeqChange(baseChange) && isSeqChange(change)) {
    const rebasedMutations = change[1].map((mutation): ListMutation => {
      if (isPatchMutation(mutation)) {
        return rebasePatchMutation(mutation, baseChange[1]);
      }
      return rebasePositionalMutation(mutation, baseChange[1]);
    });

    return ["seq", rebasedMutations];
  }

  if (isPatchChange(baseChange) && isPatchChange(change)) {
    return ["patch", rebaseChangeset(baseChange[1], change[1])];
  }

  return change;
};

export const rebaseChangeset = (
  base: FieldChangeset,
  changeset: FieldChangeset,
): FieldChangeset =>
  mapObjectValues(changeset, (change, key) => {
    const baseChange = base[key];
    const normalizedChange = normalizeValueChange(change);
    return baseChange
      ? rebaseChange(normalizeValueChange(baseChange), normalizedChange)
      : normalizedChange;
  });

export type RelationTuple = [ref: string, attrs: Fieldset];

export const isRelationTuple = (value: FieldValue): value is RelationTuple =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "object" &&
  value[1] !== null &&
  !Array.isArray(value[1]);

export const getRelationRef = (value: FieldValue): string | undefined => {
  if (typeof value === "string") return value;
  if (isRelationTuple(value)) return value[0];
  return undefined;
};

const applyInsertMutation = (
  arr: FieldValue[],
  mutation: ListMutationInsert,
): FieldValue[] => {
  const [, value, position] = mutation;
  const result = [...arr];
  const pos = position ?? result.length;
  // Insert position can be 0..length (inserting at end is valid)
  assertInRange(pos, 0, result.length, "insert mutation position");
  if (isEqual(result[pos], value)) result.splice(pos, 1);
  else result.splice(pos, 0, value);
  return result;
};

const applyRemoveMutation = (
  arr: FieldValue[],
  mutation: ListMutationRemove,
): FieldValue[] => {
  const [, value, position] = mutation;
  const result = [...arr];
  const pos = position ?? result.length - 1;
  assertInArrayRange(pos, result, "remove mutation position");
  assertEqual(result[pos], value, "remove mutation value");
  result.splice(pos, 1);
  return result;
};

const applyPatchMutation = (
  arr: FieldValue[],
  mutation: ListMutationPatch,
): FieldValue[] => {
  const [, ref, attrChangeset] = mutation;
  const idx = arr.findIndex((item) => getRelationRef(item) === ref);
  assert(idx !== -1, "patch mutation ref", `ref "${ref}" not found in array`);

  const currentItem = arr[idx]!;
  const currentAttrs = isRelationTuple(currentItem) ? currentItem[1] : {};
  const newAttrs = applyChangeset(currentAttrs, attrChangeset);

  const result = [...arr];
  result[idx] = [ref, newAttrs];
  return result;
};

export const applyChange = (
  current: FieldValue,
  change: ValueChange,
): FieldValue => {
  if (isSetChange(change)) {
    const previous = getSetPrevious(change);
    if (current === null || current === undefined) {
      assertUndefined(previous, "change.previous");
    } else {
      assertEqual(current, previous, "change field");
    }
    return change[1];
  }
  if (isClearChange(change)) {
    assertEqual(current, change[1], "change field");
    return null;
  }
  if (isSeqChange(change)) {
    let result = current ?? [];
    for (const mutation of change[1]) {
      assertType(
        result,
        (it): it is FieldValue[] => Array.isArray(it),
        "field value",
      );

      if (isInsertMutation(mutation)) {
        result = applyInsertMutation(result, mutation);
      } else if (isRemoveMutation(mutation)) {
        result = applyRemoveMutation(result, mutation);
      } else if (isPatchMutation(mutation)) {
        result = applyPatchMutation(result, mutation);
      }
    }
    return Array.isArray(result) && result.length === 0 ? null : result;
  }
  if (isPatchChange(change)) {
    const ref = getRelationRef(current);
    if (ref === undefined) {
      assertFailed("Patch operation requires a relation value with a ref");
    }
    const currentAttrs = isRelationTuple(current) ? current[1] : {};
    const newAttrs = applyChangeset(currentAttrs, change[1]);
    return [ref, newAttrs];
  }
  assertFailed("Unknown change kind");
};

export const applyChangeset = (
  fields: Fieldset,
  changeset: FieldChangeset,
): Fieldset => {
  const applied = mapObjectValues(changeset, (change, key) =>
    applyChange(fields[key], normalizeValueChange(change)),
  );
  return filterObjectValues({ ...fields, ...applied }, (value, key) => {
    if (key in applied) {
      if (value === null) {
        const change = normalizeValueChange(changeset[key]);
        return !isSeqChange(change);
      }
      return true;
    }
    return value !== null && !(Array.isArray(value) && value.length === 0);
  });
};

const squashPositionalMutation = (
  mutation: ListMutationInsert | ListMutationRemove,
  combinedMutations: ListMutation[],
): ListMutation | null => {
  const [kind, value, position] = mutation;

  if (kind === "remove") {
    const cancelIndex = combinedMutations.findIndex(
      (m) =>
        isInsertMutation(m) &&
        (m[2] === position || (m[2] === undefined && position === undefined)) &&
        isEqual(m[1], value),
    );

    if (cancelIndex !== -1) {
      const removedInsert = combinedMutations[
        cancelIndex
      ] as ListMutationInsert;
      const removedInsertPos = removedInsert[2];
      combinedMutations.splice(cancelIndex, 1);

      if (removedInsertPos !== undefined) {
        for (let i = cancelIndex; i < combinedMutations.length; i++) {
          const m = combinedMutations[i]!;
          if (isPatchMutation(m)) continue;
          const pos = m[2];
          if (pos !== undefined && pos > removedInsertPos) {
            combinedMutations[i] = [m[0], m[1], pos - 1];
          }
        }
      }
      return null;
    }
  }

  if (position === undefined) {
    return mutation;
  }

  let adjustedPosition = position;
  for (const m of combinedMutations) {
    if (isPatchMutation(m)) continue;
    const basePos = m[2];
    if (basePos === undefined) continue;
    if (m[0] === "insert" && basePos <= adjustedPosition) {
      adjustedPosition++;
    } else if (m[0] === "remove" && basePos < adjustedPosition) {
      adjustedPosition--;
    }
  }

  return [kind, value, adjustedPosition];
};

const squashPatchMutation = (
  mutation: ListMutationPatch,
  combinedMutations: ListMutation[],
): ListMutation => {
  const [, ref, attrChangeset] = mutation;

  const existingPatchIdx = combinedMutations.findIndex(
    (m): m is ListMutationPatch => isPatchMutation(m) && m[1] === ref,
  );

  if (existingPatchIdx !== -1) {
    const existingPatch = combinedMutations[
      existingPatchIdx
    ] as ListMutationPatch;
    const squashedAttrs = squashChangesets(existingPatch[2], attrChangeset);
    combinedMutations.splice(existingPatchIdx, 1);
    return ["patch", ref, squashedAttrs];
  }

  return mutation;
};

const getValueOrNull = (
  change: ValueChangeSet | ValueChangeClear,
): FieldValue => (isSetChange(change) ? change[1] : null);

const getPreviousOrNull = (
  change: ValueChangeSet | ValueChangeClear,
): FieldValue =>
  isSetChange(change) ? (getSetPrevious(change) ?? null) : change[1];

const makeSetOrClear = (
  value: FieldValue,
  previous: FieldValue | undefined,
): ValueChangeSet | ValueChangeClear => {
  if (value === null) return ["clear", previous!];
  if (previous === undefined) return ["set", value];
  return ["set", value, previous];
};

export const squashChange = (
  baseChange: ValueChange,
  change: ValueChange,
): ValueChange | null => {
  if (
    (isSetChange(baseChange) || isClearChange(baseChange)) &&
    (isSetChange(change) || isClearChange(change))
  ) {
    const changeValue = getValueOrNull(change);
    const basePrevious = getPreviousOrNull(baseChange);
    if (isEqual(changeValue, basePrevious)) return null;
    return makeSetOrClear(changeValue, basePrevious ?? undefined);
  }

  if (
    (isSetChange(baseChange) || isClearChange(baseChange)) &&
    isSeqChange(change)
  ) {
    const baseValue = getValueOrNull(baseChange);
    const basePrevious = getPreviousOrNull(baseChange);
    const resultValue = applyChange(baseValue, change);
    return makeSetOrClear(resultValue, basePrevious ?? undefined);
  }

  if (isSeqChange(baseChange) && isSeqChange(change)) {
    const combinedMutations = [...baseChange[1]];

    for (const nextMutation of change[1]) {
      let result: ListMutation | null;

      if (isPatchMutation(nextMutation)) {
        result = squashPatchMutation(nextMutation, combinedMutations);
      } else {
        result = squashPositionalMutation(nextMutation, combinedMutations);
      }

      if (result !== null) {
        combinedMutations.push(result);
      }
    }

    return ["seq", combinedMutations];
  }

  if (isPatchChange(baseChange) && isPatchChange(change)) {
    const squashedAttrs = squashChangesets(baseChange[1], change[1]);
    if (Object.keys(squashedAttrs).length === 0) {
      return null;
    }
    return ["patch", squashedAttrs];
  }

  if (
    (isSetChange(baseChange) || isClearChange(baseChange)) &&
    isPatchChange(change)
  ) {
    const baseValue = getValueOrNull(baseChange);
    const basePrevious = getPreviousOrNull(baseChange);
    const resultValue = applyChange(baseValue, change);
    return makeSetOrClear(resultValue, basePrevious ?? undefined);
  }

  assertFailed(`Cannot squash ${baseChange[0]} and ${change[0]} operations`);
};

export const squashChangesets = (
  base: FieldChangeset,
  changeset: FieldChangeset,
): FieldChangeset => {
  const squashedChanges = { ...base };
  for (const [objKey, change] of Object.entries(changeset)) {
    const key = objKey as EntityKey;
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

  return filterObjectValues(squashedChanges, (change) => {
    const normalized = normalizeValueChange(change);
    return !(isSeqChange(normalized) && normalized[1].length === 0);
  });
};

export const isListMutation = (value: unknown): value is ListMutation =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.length <= 3 &&
  (value[0] === "insert" || value[0] === "remove" || value[0] === "patch");

export const isListMutationArray = (value: unknown): value is ListMutation[] =>
  Array.isArray(value) && value.length > 0 && value.every(isListMutation);

export const isInsertMutation = (
  mutation: ListMutation,
): mutation is ListMutationInsert => mutation[0] === "insert";

export const isRemoveMutation = (
  mutation: ListMutation,
): mutation is ListMutationRemove => mutation[0] === "remove";

export const isPatchMutation = (
  mutation: ListMutation,
): mutation is ListMutationPatch => mutation[0] === "patch";

const getMutationPosition = (m: ListMutation): number => {
  if (isPatchMutation(m)) return Infinity;
  return m[2] ?? Infinity;
};

const compareListMutations = (a: ListMutation, b: ListMutation): number => {
  const posA = getMutationPosition(a);
  const posB = getMutationPosition(b);
  if (posA !== posB) return posA - posB;
  if (a[0] === "insert" && b[0] === "remove") return -1;
  if (a[0] === "remove" && b[0] === "insert") return 1;
  return 0;
};

const canonicalizeValueChange = (change: ValueChange): ValueChange => {
  if (isSeqChange(change)) {
    return ["seq", [...change[1]].sort(compareListMutations)];
  }
  return change;
};

export const canonicalizeFieldChangeset = (
  schema: EntitySchema,
  changeset: FieldChangeset,
): FieldChangeset =>
  transformEntries(changeset, (entries) =>
    entries
      .map(([key, value]) => {
        const fieldDef = schema.fields[key];
        if (fieldDef === undefined) return null;
        const normalized = normalizeValueChange(value);
        const canonical = canonicalizeValueChange(normalized);
        return [key, fieldDef.id, compactValueChange(canonical)] as const;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a[1] - b[1])
      .map(
        ([key, _, value]) => [key, value] as [string, ValueChange | FieldValue],
      ),
  );

export const canonicalizeEntitiesChangeset = <N extends NamespaceEditable>(
  schema: NamespaceSchema<N>,
  changeset: EntitiesChangeset<N>,
): EntitiesChangeset<N> =>
  transformEntries(changeset, (entries) =>
    entries
      .map(([ref, fieldChangeset]): [string, FieldChangeset] => [
        ref,
        canonicalizeFieldChangeset(schema, fieldChangeset),
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ) as EntitiesChangeset<N>;

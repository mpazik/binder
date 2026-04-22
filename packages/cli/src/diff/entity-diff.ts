import type {
  ChangesetsInput,
  EntityChangesetInput,
  EntitySchema,
  EntityType,
  EntityUid,
  FieldKey,
  FieldNestedValue,
  Fieldset,
  FieldsetNested,
  FieldValue,
  ListMutation,
  RecordUid,
  QueryParams,
} from "@binder/repo";
import {
  coreIdentityFieldKeys,
  createUid,
  extractUid,
  getTypeFieldAttrs,
  getTypeFieldKey,
  isFieldsetNested,
} from "@binder/repo";
import {
  assert,
  assertDefined,
  fail,
  includes,
  isEqual,
  isErr,
  isObjectNonEmpty,
  ok,
  type Result,
} from "@binder/utils";
import { extractFieldsetFromQuery } from "../utils/query.ts";
import { matchEntities, type MatcherConfig } from "./entity-matcher.ts";
import { classifyFields } from "./field-classifier.ts";

const getType = (node: Fieldset): EntityType | undefined =>
  typeof node.type === "string" ? (node.type as EntityType) : undefined;

const collectNonIdentityFields = (
  schema: EntitySchema,
  node: FieldsetNested,
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "id" || key === "uid" || key === "type") continue;
    const fieldDef = schema.fields[key as FieldKey];
    if (fieldDef?.dataType === "relation" && fieldDef.allowMultiple) continue;
    fields[key] = value;
  }
  return fields;
};

const resolveEffectiveRange = (
  schema: EntitySchema,
  fieldKey: FieldKey,
  parentType: EntityType | undefined,
  fieldRange: EntityType[] | undefined,
): EntityType[] | undefined => {
  if (fieldRange !== undefined) return fieldRange;
  if (!parentType) return undefined;
  const typeDef = schema.types[parentType];
  if (!typeDef) return undefined;
  const fieldRef = typeDef.fields.find((f) => getTypeFieldKey(f) === fieldKey);
  const only = getTypeFieldAttrs(fieldRef!)?.only as EntityType[] | undefined;
  return only;
};

const buildEntityCreate = (
  schema: EntitySchema,
  node: FieldsetNested,
  generatedUid: RecordUid,
  effectiveRange: EntityType[] | undefined,
): EntityChangesetInput<"record"> | null => {
  const type =
    getType(node) ??
    (effectiveRange?.length === 1 ? effectiveRange[0] : undefined);
  if (!type) return null;

  return {
    type,
    uid: generatedUid,
    ...collectNonIdentityFields(schema, node),
  } as EntityChangesetInput<"record">;
};

const extractOwnedChildren = (value: FieldNestedValue): FieldsetNested[] => {
  if (value === null || !Array.isArray(value)) return [];
  return value.filter(isFieldsetNested);
};

const diffOwnedChildren = (
  schema: EntitySchema,
  fieldKey: FieldKey,
  newChildren: FieldsetNested[],
  oldChildren: FieldsetNested[],
  effectiveRange: EntityType[] | undefined,
): Result<{ changesets: ChangesetsInput; mutations: ListMutation[] }> => {
  const changesets: ChangesetsInput = [];
  const mutations: ListMutation[] = [];

  const classifications = classifyFields(schema);
  const config: MatcherConfig = { schema, classifications };

  const matchResult = matchEntities(config, newChildren, oldChildren);

  for (const newIdx of matchResult.toCreate) {
    const generatedUid = createUid() as RecordUid;
    const created = buildEntityCreate(
      schema,
      newChildren[newIdx]!,
      generatedUid,
      effectiveRange,
    );
    if (!created) {
      return fail(
        "cannot_determine_type",
        `Cannot create entity for relation field '${fieldKey}': type cannot be determined. ` +
          `Add a range or only constraint to the field, or include a type in the document.`,
      );
    }
    changesets.push(created);
    mutations.push(["insert", generatedUid]);
  }

  for (const oldIdx of matchResult.toRemove) {
    const oldNode = oldChildren[oldIdx]!;
    const oldUid = extractUid(oldNode);
    assertDefined(oldUid, "oldUid in diffOwnedChildren toRemove");
    mutations.push(["remove", oldUid]);
  }

  for (const { newIndex, oldIndex } of matchResult.matches) {
    const result = diffEntities(
      schema,
      newChildren[newIndex]!,
      oldChildren[oldIndex]!,
    );
    if (isErr(result)) return result;
    changesets.push(...result.data);
  }

  return ok({ changesets, mutations });
};

const diffSingleRelation = (
  schema: EntitySchema,
  newValue: FieldNestedValue,
  oldValue: FieldNestedValue,
): Result<ChangesetsInput> => {
  if (!isFieldsetNested(newValue) || !isFieldsetNested(oldValue)) return ok([]);

  const oldUid = extractUid(oldValue);
  const newUid = extractUid(newValue);

  // When newUid is undefined but oldUid exists, we're editing the same related
  // entity (extracted from markdown doesn't include uid). Set uid from old.
  if (!oldUid) return ok([]);
  if (newUid !== undefined && oldUid !== newUid) return ok([]);

  const newWithUid = newUid ? newValue : { ...newValue, uid: oldUid };
  return diffEntities(schema, newWithUid, oldValue);
};

const isComplex = (value: unknown): boolean =>
  typeof value === "object" && value !== null;

const diffMultipleValues = (
  newValue: unknown,
  oldValue: unknown,
): ListMutation[] => {
  const newArray = Array.isArray(newValue) ? newValue : [];
  const oldArray = Array.isArray(oldValue) ? oldValue : [];

  const hasComplex = newArray.some(isComplex) || oldArray.some(isComplex);

  if (!hasComplex) {
    const oldSet = new Set(oldArray);
    const newSet = new Set(newArray);
    const mutations: ListMutation[] = [];
    for (const item of oldArray) {
      if (!newSet.has(item)) mutations.push(["remove", item]);
    }
    for (const item of newArray) {
      if (!oldSet.has(item)) mutations.push(["insert", item]);
    }
    return mutations;
  }

  // Deep-equality path for arrays containing objects/tuples
  const mutations: ListMutation[] = [];
  const matchedNew = new Set<number>();

  for (const item of oldArray) {
    const idx = newArray.findIndex(
      (n, i) => !matchedNew.has(i) && isEqual(n, item),
    );
    if (idx >= 0) matchedNew.add(idx);
    else mutations.push(["remove", item]);
  }

  for (let i = 0; i < newArray.length; i++) {
    if (!matchedNew.has(i)) mutations.push(["insert", newArray[i]]);
  }

  return mutations;
};

const collectAllFieldKeys = (
  newEntity: FieldsetNested,
  oldEntity: FieldsetNested,
): FieldKey[] => [
  ...new Set([
    ...Object.keys(newEntity),
    ...Object.keys(oldEntity),
  ] as FieldKey[]),
];

type FieldDiffResult = {
  changesets?: ChangesetsInput;
  fieldChange?: FieldValue;
};

const diffField = (
  schema: EntitySchema,
  fieldKey: FieldKey,
  newValue: FieldNestedValue,
  oldValue: FieldNestedValue,
  parentType: EntityType | undefined,
): Result<FieldDiffResult | null> => {
  if (includes(coreIdentityFieldKeys, fieldKey)) return ok(null);

  const fieldDef = schema.fields[fieldKey];

  if (fieldDef?.dataType === "relation" && fieldDef.allowMultiple) {
    const newChildren = extractOwnedChildren(newValue);
    const oldChildren = extractOwnedChildren(oldValue);

    if (newChildren.length > 0 || oldChildren.length > 0) {
      const effectiveRange = resolveEffectiveRange(
        schema,
        fieldKey,
        parentType,
        fieldDef.range,
      );
      const result = diffOwnedChildren(
        schema,
        fieldKey,
        newChildren,
        oldChildren,
        effectiveRange,
      );
      if (isErr(result)) return result;
      const fieldChange =
        result.data.mutations.length > 0
          ? (result.data.mutations as FieldValue)
          : undefined;
      return ok({ changesets: result.data.changesets, fieldChange });
    }

    // No nested fieldsets (e.g. relation refs stored as strings/tuples).
    // Fall through to diffMultipleValues below.
  }

  if (fieldDef?.dataType === "relation") {
    if (isFieldsetNested(newValue)) {
      assert(
        isFieldsetNested(oldValue),
        `relation field '${fieldKey}'`,
        `oldValue must be a nested fieldset when newValue is nested (got ${typeof oldValue}). ` +
          `Ensure the navigation item or view includes the relation field.`,
      );
      const result = diffSingleRelation(schema, newValue, oldValue);
      if (isErr(result)) return result;
      return ok({ changesets: result.data });
    }
  }

  if (newValue === undefined) return ok(null);
  if (newValue === null && (oldValue === null || oldValue === undefined))
    return ok(null);

  if (fieldDef?.allowMultiple) {
    const mutations = diffMultipleValues(newValue, oldValue);
    if (mutations.length === 0) return ok(null);
    return ok({ fieldChange: mutations as FieldValue });
  }

  if (!isEqual(newValue, oldValue)) {
    return ok({ fieldChange: newValue as FieldValue });
  }

  return ok(null);
};

export const diffEntities = (
  schema: EntitySchema,
  newEntity: FieldsetNested,
  oldEntity: FieldsetNested,
): Result<ChangesetsInput> => {
  const uid = extractUid(oldEntity);
  assertDefined(uid, "uid in diffEntities oldEntity");

  const parentType = getType(oldEntity);
  const changesets: ChangesetsInput = [];
  const fieldChanges: Record<FieldKey, FieldValue> = {};

  for (const fieldKey of collectAllFieldKeys(newEntity, oldEntity)) {
    const result = diffField(
      schema,
      fieldKey,
      newEntity[fieldKey],
      oldEntity[fieldKey],
      parentType,
    );
    if (isErr(result)) return result;
    if (!result.data) continue;

    if (result.data.changesets !== undefined) {
      changesets.push(...result.data.changesets);
    }
    if (result.data.fieldChange !== undefined) {
      fieldChanges[fieldKey] = result.data.fieldChange;
    }
  }

  if (isObjectNonEmpty(fieldChanges)) {
    changesets.unshift({ uid, ...fieldChanges });
  }

  return ok(changesets);
};

export type DiffQueryResult = {
  toCreate: EntityChangesetInput<"record">[];
  toUpdate: ChangesetsInput<"record">;
  toRemove: EntityUid[];
};

const hydrateEntity = (
  schema: EntitySchema,
  entity: FieldsetNested,
  queryContext: Fieldset,
): EntityChangesetInput<"record"> | null => {
  const hydrated = { ...queryContext, ...entity };
  const type = getType(hydrated);
  if (!type) return null;

  return {
    type,
    ...collectNonIdentityFields(schema, hydrated),
  } as EntityChangesetInput<"record">;
};

export const diffQueryResults = (
  schema: EntitySchema,
  newEntities: FieldsetNested[],
  oldEntities: FieldsetNested[],
  query: QueryParams,
): Result<DiffQueryResult> => {
  const toCreate: EntityChangesetInput<"record">[] = [];
  const toUpdate: ChangesetsInput<"record"> = [];

  const queryContext = extractFieldsetFromQuery(query);
  const excludeFields = new Set(Object.keys(queryContext) as FieldKey[]);

  const classifications = classifyFields(schema);
  const config: MatcherConfig = { schema, classifications, excludeFields };

  const matchResult = matchEntities(config, newEntities, oldEntities);

  for (const newIdx of matchResult.toCreate) {
    const entity = newEntities[newIdx]!;
    const hydrated = hydrateEntity(schema, entity, queryContext);
    if (hydrated) toCreate.push(hydrated);
  }

  for (const { newIndex, oldIndex } of matchResult.matches) {
    const result = diffEntities(
      schema,
      newEntities[newIndex]!,
      oldEntities[oldIndex]!,
    );
    if (isErr(result)) return result;
    toUpdate.push(...result.data);
  }

  const toRemove = matchResult.toRemove.map((oldIdx) => {
    const uid = extractUid(oldEntities[oldIdx]!);
    assertDefined(uid, "uid in diffQueryResults toRemove");
    return uid as EntityUid;
  });

  return ok({ toCreate, toUpdate, toRemove });
};

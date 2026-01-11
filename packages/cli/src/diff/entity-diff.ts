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
  NodeUid,
  QueryParams,
} from "@binder/db";
import { coreIdentityFieldKeys, createUid, isFieldsetNested } from "@binder/db";
import { assert, assertDefined, includes, isEqual } from "@binder/utils";
import { extractFieldsetFromQuery } from "../utils/query.ts";
import { matchEntities, type MatcherConfig } from "./entity-matcher.ts";
import { classifyFields } from "./field-classifier.ts";

const getUid = (node: Fieldset): EntityUid | undefined => {
  const uid = node.uid;
  return typeof uid === "string" ? (uid as EntityUid) : undefined;
};

const getType = (node: Fieldset): EntityType | undefined => {
  const type = node.type;
  return typeof type === "string" ? (type as EntityType) : undefined;
};

const buildEntityCreate = (
  schema: EntitySchema,
  node: FieldsetNested,
  generatedUid: NodeUid,
): EntityChangesetInput<"node"> | null => {
  const type = getType(node);
  if (!type) return null;

  const fields: Record<string, unknown> = { uid: generatedUid };
  for (const [key, value] of Object.entries(node)) {
    if (includes(coreIdentityFieldKeys, key)) continue;

    const fieldDef = schema.fields[key as FieldKey];
    if (fieldDef?.dataType === "relation" && fieldDef.allowMultiple) continue;

    fields[key] = value;
  }

  return { type, ...fields } as EntityChangesetInput<"node">;
};

const extractOwnedChildren = (value: FieldNestedValue): FieldsetNested[] => {
  if (value === null || !Array.isArray(value)) return [];
  return value.filter(isFieldsetNested);
};

const diffOwnedChildren = (
  schema: EntitySchema,
  newChildren: FieldsetNested[],
  oldChildren: FieldsetNested[],
): { changesets: ChangesetsInput; mutations: ListMutation[] } => {
  const changesets: ChangesetsInput = [];
  const mutations: ListMutation[] = [];

  const classifications = classifyFields(schema);
  const config: MatcherConfig = { schema, classifications };

  const matchResult = matchEntities(config, newChildren, oldChildren);

  for (const newIdx of matchResult.toCreate) {
    const newEntity = newChildren[newIdx]!;
    const generatedUid = createUid() as NodeUid;

    const createChangeset = buildEntityCreate(schema, newEntity, generatedUid);
    if (createChangeset) changesets.push(createChangeset);

    mutations.push(["insert", generatedUid]);
  }

  for (const oldIdx of matchResult.toRemove) {
    const oldNode = oldChildren[oldIdx]!;
    const oldUid = getUid(oldNode);
    assertDefined(oldUid, "oldUid in diffOwnedChildren toRemove");
    mutations.push(["remove", oldUid]);
  }

  for (const { newIndex, oldIndex } of matchResult.matches) {
    const newNode = newChildren[newIndex]!;
    const oldNode = oldChildren[oldIndex]!;

    const childChangesets = diffEntities(schema, newNode, oldNode);
    changesets.push(...childChangesets);
  }

  return { changesets, mutations };
};

const diffSingleRelation = (
  schema: EntitySchema,
  newValue: FieldNestedValue,
  oldValue: FieldNestedValue,
): ChangesetsInput => {
  if (!isFieldsetNested(newValue) || !isFieldsetNested(oldValue)) return [];

  const oldUid = getUid(oldValue);
  const newUid = getUid(newValue);

  // When newUid is undefined but oldUid exists, we're editing the same related
  // entity (extracted from markdown doesn't include uid). Set uid from old.
  if (!oldUid) return [];
  if (newUid !== undefined && oldUid !== newUid) return [];

  const newWithUid = newUid ? newValue : { ...newValue, uid: oldUid };
  return diffEntities(schema, newWithUid, oldValue);
};

const diffMultipleValues = (
  newValue: unknown,
  oldValue: unknown,
): ListMutation[] => {
  const newArray = Array.isArray(newValue) ? newValue : [];
  const oldArray = Array.isArray(oldValue) ? oldValue : [];

  const oldSet = new Set(oldArray);
  const newSet = new Set(newArray);

  const mutations: ListMutation[] = [];

  for (const item of oldArray) {
    if (!newSet.has(item)) {
      mutations.push(["remove", item]);
    }
  }

  for (const item of newArray) {
    if (!oldSet.has(item)) {
      mutations.push(["insert", item]);
    }
  }

  return mutations;
};

const collectAllFieldKeys = (
  newEntity: FieldsetNested,
  oldEntity: FieldsetNested,
): FieldKey[] => {
  const keys = new Set<FieldKey>();
  for (const key of Object.keys(newEntity)) keys.add(key as FieldKey);
  for (const key of Object.keys(oldEntity)) keys.add(key as FieldKey);
  return [...keys];
};

type FieldDiffResult = {
  changesets?: ChangesetsInput;
  fieldChange?: FieldValue;
};

const diffField = (
  schema: EntitySchema,
  fieldKey: FieldKey,
  newValue: FieldNestedValue,
  oldValue: FieldNestedValue,
): FieldDiffResult | null => {
  if (includes(coreIdentityFieldKeys, fieldKey)) return null;

  const fieldDef = schema.fields[fieldKey];

  if (fieldDef?.dataType === "relation" && fieldDef.allowMultiple) {
    const newChildren = extractOwnedChildren(newValue);
    const oldChildren = extractOwnedChildren(oldValue);
    if (newChildren.length === 0 && oldChildren.length === 0) return null;

    const result = diffOwnedChildren(schema, newChildren, oldChildren);
    const fieldChange =
      result.mutations.length > 0
        ? (result.mutations as FieldValue)
        : undefined;
    return { changesets: result.changesets, fieldChange };
  }

  if (fieldDef?.dataType === "relation") {
    if (isFieldsetNested(newValue)) {
      assert(
        isFieldsetNested(oldValue),
        `relation field '${fieldKey}'`,
        `oldValue must be a nested fieldset when newValue is nested (got ${typeof oldValue}). ` +
          `Ensure the navigation item or template includes the relation field.`,
      );
      return { changesets: diffSingleRelation(schema, newValue, oldValue) };
    }
  }

  if (newValue === undefined) return null;
  if (newValue === null && (oldValue === null || oldValue === undefined))
    return null;

  if (fieldDef?.allowMultiple) {
    const mutations = diffMultipleValues(newValue, oldValue);
    if (mutations.length === 0) return null;
    return { fieldChange: mutations as FieldValue };
  }

  if (!isEqual(newValue, oldValue)) {
    return { fieldChange: newValue as FieldValue };
  }

  return null;
};

export const diffEntities = (
  schema: EntitySchema,
  newEntity: FieldsetNested,
  oldEntity: FieldsetNested,
): ChangesetsInput => {
  const uid = getUid(oldEntity);
  assertDefined(uid, "uid in diffEntities oldEntity");

  const changesets: ChangesetsInput = [];
  const fieldChanges: Record<FieldKey, FieldValue> = {};

  for (const fieldKey of collectAllFieldKeys(newEntity, oldEntity)) {
    const result = diffField(
      schema,
      fieldKey,
      newEntity[fieldKey],
      oldEntity[fieldKey],
    );
    if (!result) continue;

    if (result.changesets !== undefined) {
      changesets.push(...result.changesets);
    }
    if (result.fieldChange !== undefined) {
      fieldChanges[fieldKey] = result.fieldChange;
    }
  }

  if (Object.keys(fieldChanges).length > 0) {
    changesets.unshift({ $ref: uid, ...fieldChanges });
  }

  return changesets;
};

export type DiffQueryResult = {
  toCreate: EntityChangesetInput<"node">[];
  toUpdate: ChangesetsInput<"node">;
};

const hydrateEntity = (
  schema: EntitySchema,
  entity: FieldsetNested,
  queryContext: Fieldset,
): EntityChangesetInput<"node"> | null => {
  const hydrated = { ...queryContext, ...entity };
  const type = hydrated.type;
  if (typeof type !== "string") return null;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hydrated)) {
    if (includes(coreIdentityFieldKeys, key)) continue;
    const fieldDef = schema.fields[key as FieldKey];
    if (fieldDef?.dataType === "relation" && fieldDef.allowMultiple) continue;
    fields[key] = value;
  }

  return { type, ...fields } as EntityChangesetInput<"node">;
};

export const diffQueryResults = (
  schema: EntitySchema,
  newEntities: FieldsetNested[],
  oldEntities: FieldsetNested[],
  query: QueryParams,
): DiffQueryResult => {
  const toCreate: EntityChangesetInput<"node">[] = [];
  const toUpdate: ChangesetsInput<"node"> = [];

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
    const newEntity = newEntities[newIndex]!;
    const oldEntity = oldEntities[oldIndex]!;

    const entityChangesets = diffEntities(schema, newEntity, oldEntity);
    toUpdate.push(...entityChangesets);
  }

  return { toCreate, toUpdate };
};

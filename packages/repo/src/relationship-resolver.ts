import { isErr, ok, type ResultAsync } from "@binder/utils";
import {
  type EntitySchema,
  type FieldKey,
  type Fieldset,
  type FieldValue,
  type Filters,
  type Includes,
  isIncludesQuery,
  isObjectIncludes,
  type NamespaceEditable,
} from "./model";
import type { DbTransaction } from "./db.ts";

const getEntityFieldValue = (
  entity: Fieldset,
  fieldName: FieldKey,
): string | string[] | undefined => {
  const value = entity[fieldName];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "object" && value !== null && "uid" in value)
    return value.uid as string;
  return undefined;
};

const extractRelationId = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  // Handle tuple format [key, attrs] from TypeFieldRef
  if (Array.isArray(value) && value.length >= 1 && typeof value[0] === "string")
    return value[0];
  return undefined;
};

const collectRelationshipIds = (
  entities: Fieldset[],
  fieldName: FieldKey,
): Set<string> => {
  const ids = new Set<string>();

  for (const entity of entities) {
    const fieldValue = getEntityFieldValue(entity, fieldName);
    if (!fieldValue) continue;

    if (Array.isArray(fieldValue)) {
      for (const item of fieldValue) {
        const id = extractRelationId(item);
        if (id) ids.add(id);
      }
    } else {
      ids.add(fieldValue);
    }
  }

  return ids;
};

const findRelatedEntity = (
  ref: string,
  relatedEntities: Fieldset[],
): Fieldset | undefined =>
  relatedEntities.find((e) => e.uid === ref || e.key === ref);

const pickFields = (entity: Fieldset, keys: Includes): Fieldset => {
  const result: Fieldset = {};
  for (const [key, val] of Object.entries(entity)) {
    if (key in keys) result[key] = val;
  }
  return result;
};

const mergeRelationshipData = (
  entities: Fieldset[],
  fieldName: FieldKey,
  relatedEntities: Fieldset[],
  inverseFieldName: FieldKey | undefined,
  fieldIsMultiple: boolean,
): void => {
  const isSelfInverse = inverseFieldName === fieldName;
  if (inverseFieldName) {
    for (const entity of entities) {
      const entityUid = entity.uid as string;
      const inverseMatching = relatedEntities.filter((related) => {
        const inverseValue = getEntityFieldValue(related, inverseFieldName);
        if (!inverseValue) return false;
        if (Array.isArray(inverseValue))
          return inverseValue.includes(entityUid);
        return inverseValue === entityUid;
      });

      if (isSelfInverse && fieldIsMultiple) {
        // Self-inverse M:M: also resolve forward stored links
        const fieldValue = getEntityFieldValue(entity, fieldName);
        const forwardMatching: Fieldset[] = [];
        if (fieldValue && Array.isArray(fieldValue)) {
          for (const id of fieldValue) {
            const idStr = extractRelationId(id);
            if (!idStr) continue;
            const found = findRelatedEntity(idStr, relatedEntities);
            if (found) forwardMatching.push(found);
          }
        }
        // Merge and deduplicate by uid
        const seen = new Set<string>();
        const merged: Fieldset[] = [];
        for (const e of [...forwardMatching, ...inverseMatching]) {
          const uid = e.uid as string;
          if (!seen.has(uid)) {
            seen.add(uid);
            merged.push(e);
          }
        }
        entity[fieldName] = merged;
      } else {
        // For 1:1 inverse (single-value field), return single entity not array
        entity[fieldName] = fieldIsMultiple
          ? inverseMatching
          : (inverseMatching[0] ?? null);
      }
    }
  } else {
    for (const entity of entities) {
      const fieldValue = getEntityFieldValue(entity, fieldName);
      if (!fieldValue) continue;

      if (Array.isArray(fieldValue)) {
        const rawFieldValue = entity[fieldName] as FieldValue[];
        entity[fieldName] = rawFieldValue.map((item, index) => {
          const idStr = extractRelationId(fieldValue[index]);
          if (!idStr) return item;
          return findRelatedEntity(idStr, relatedEntities) ?? item;
        });
      } else {
        const found = findRelatedEntity(fieldValue, relatedEntities);
        if (found) entity[fieldName] = found;
      }
    }
  }
};

const applyFieldSelection = (
  entities: Fieldset[],
  includes: Includes,
): Fieldset[] =>
  entities.map((entity) => {
    const selected: Fieldset = {};
    for (const fieldName of Object.keys(includes)) {
      if (includes[fieldName] && fieldName in entity) {
        selected[fieldName] = entity[fieldName];
      }
    }
    return selected;
  });

const cleanRelatedEntities = (
  entities: Fieldset[],
  includes: Includes,
): void => {
  for (const entity of entities) {
    for (const [fieldKey, fieldValue] of Object.entries(entity)) {
      const fieldInclude = includes[fieldKey];
      if (!isObjectIncludes(fieldInclude)) continue;

      const nestedIncludes = isIncludesQuery(fieldInclude)
        ? fieldInclude.includes
        : fieldInclude;
      if (!nestedIncludes) continue;

      if (Array.isArray(fieldValue)) {
        entity[fieldKey] = (fieldValue as Fieldset[]).map((related) =>
          pickFields(related, nestedIncludes),
        );
      } else if (typeof fieldValue === "object" && fieldValue !== null) {
        entity[fieldKey] = pickFields(fieldValue as Fieldset, nestedIncludes);
      }
    }
  }
};

export const resolveIncludes = async (
  tx: DbTransaction,
  entities: Fieldset[],
  includes: Includes | undefined,
  namespace: NamespaceEditable,
  schema: EntitySchema,
  searchFn: (
    tx: DbTransaction,
    namespace: NamespaceEditable,
    filters: Filters,
    schema: EntitySchema,
  ) => ResultAsync<Fieldset[]>,
): ResultAsync<Fieldset[]> => {
  if (entities.length === 0 || !includes) return ok(entities);

  for (const [fieldKey, includeValue] of Object.entries(includes)) {
    const field = schema.fields[fieldKey];
    if (!field || field.dataType !== "relation") continue;
    if (!isObjectIncludes(includeValue)) continue;
    if (
      !isIncludesQuery(includeValue) &&
      Object.keys(includeValue).length === 0
    )
      continue;

    const nestedFilters = isIncludesQuery(includeValue)
      ? includeValue.filters
      : undefined;
    const nestedIncludes = isIncludesQuery(includeValue)
      ? includeValue.includes
      : includeValue;

    let relatedFilters: Filters = {};
    const forwardIds = Array.from(collectRelationshipIds(entities, fieldKey));
    const isSelfInverse = field.inverseOf === fieldKey;

    if (field.inverseOf) {
      const entityUids = entities.map((e) => e.uid as string).filter(Boolean);
      if (entityUids.length === 0 && forwardIds.length === 0) continue;

      relatedFilters[field.inverseOf] = { op: "in", value: entityUids };
    } else {
      if (forwardIds.length === 0) continue;

      relatedFilters = { uid: { op: "in", value: forwardIds } };
    }

    let relatedEntitiesResult = await searchFn(
      tx,
      namespace,
      { ...nestedFilters, ...relatedFilters },
      schema,
    );
    if (isErr(relatedEntitiesResult)) return relatedEntitiesResult;

    // Self-inverse M:M: also fetch forward-linked entities not found by inverse lookup
    if (isSelfInverse && forwardIds.length > 0) {
      const foundUids = new Set(
        relatedEntitiesResult.data.map((e) => e.uid as string),
      );
      const missingForwardIds = forwardIds.filter((id) => !foundUids.has(id));
      if (missingForwardIds.length > 0) {
        const forwardResult = await searchFn(
          tx,
          namespace,
          { ...nestedFilters, uid: { op: "in", value: missingForwardIds } },
          schema,
        );
        if (isErr(forwardResult)) return forwardResult;
        relatedEntitiesResult.data.push(...forwardResult.data);
      }
    }

    if (
      relatedEntitiesResult.data.length === 0 &&
      !field.inverseOf &&
      relatedFilters.uid
    ) {
      relatedEntitiesResult = await searchFn(
        tx,
        namespace,
        { ...nestedFilters, key: relatedFilters.uid },
        schema,
      );
      if (isErr(relatedEntitiesResult)) return relatedEntitiesResult;
    }

    const resolvedResult = await resolveIncludes(
      tx,
      relatedEntitiesResult.data,
      nestedIncludes
        ? {
            ...nestedIncludes,
            uid: true,
            ...(field.inverseOf ? { [field.inverseOf]: true } : {}),
          }
        : undefined,
      namespace,
      schema,
      searchFn,
    );
    if (isErr(resolvedResult)) return resolvedResult;

    mergeRelationshipData(
      entities,
      fieldKey,
      resolvedResult.data,
      field.inverseOf,
      !!field.allowMultiple,
    );
  }

  const selectedEntities = applyFieldSelection(entities, includes);
  cleanRelatedEntities(selectedEntities, includes);

  return ok(selectedEntities);
};

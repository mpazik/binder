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
  if (typeof value === "object" && value !== null && "uid" in value) {
    return value.uid as string;
  }
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
  const relationshipIds = new Set<string>();

  for (const entity of entities) {
    const fieldValue = getEntityFieldValue(entity, fieldName);
    if (fieldValue) {
      if (Array.isArray(fieldValue)) {
        for (const item of fieldValue) {
          const id = extractRelationId(item);
          if (id) relationshipIds.add(id);
        }
      } else {
        relationshipIds.add(fieldValue);
      }
    }
  }

  return relationshipIds;
};

const findRelatedEntityByUid = (
  uid: string,
  relatedEntities: Fieldset[],
): Fieldset | undefined => {
  return relatedEntities.find((entity) => entity.uid === uid);
};

const findRelatedEntityByKey = (
  key: string,
  relatedEntities: Fieldset[],
): Fieldset | undefined => {
  return relatedEntities.find((entity) => entity.key === key);
};

const mergeRelationshipData = (
  entities: Fieldset[],
  fieldName: FieldKey,
  relatedEntities: Fieldset[],
  inverseFieldName: FieldKey | undefined,
): void => {
  if (inverseFieldName) {
    for (const entity of entities) {
      entity[fieldName] = relatedEntities.filter((related) => {
        const inverseValue = getEntityFieldValue(related, inverseFieldName);
        if (!inverseValue) return false;
        const entityUid = entity.uid as string;
        if (Array.isArray(inverseValue)) {
          return inverseValue.includes(entityUid);
        }
        return inverseValue === entityUid;
      });
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
          const found =
            findRelatedEntityByUid(idStr, relatedEntities) ??
            findRelatedEntityByKey(idStr, relatedEntities);
          return found ?? item;
        });
      } else {
        const found =
          findRelatedEntityByUid(fieldValue, relatedEntities) ??
          findRelatedEntityByKey(fieldValue, relatedEntities);
        if (found) entity[fieldName] = found;
      }
    }
  }
};

const applyFieldSelection = (
  entities: Fieldset[],
  includes: Includes,
): Fieldset[] => {
  return entities.map((entity) => {
    const selectedEntity: Fieldset = {};

    for (const fieldName of Object.keys(includes)) {
      const includeValue = includes[fieldName];
      if (isObjectIncludes(includeValue)) {
        if (fieldName in entity) {
          selectedEntity[fieldName] = entity[fieldName];
        }
      } else if (includeValue && fieldName in entity) {
        selectedEntity[fieldName] = entity[fieldName];
      }
    }

    return selectedEntity;
  });
};

const cleanRelatedEntities = (
  entities: Fieldset[],
  includes: Includes,
): void => {
  for (const entity of entities) {
    for (const [fieldKey, fieldValue] of Object.entries(entity)) {
      const fieldInclude = includes[fieldKey];

      if (isObjectIncludes(fieldInclude)) {
        const nestedIncludes = isIncludesQuery(fieldInclude)
          ? fieldInclude.includes
          : fieldInclude;
        if (!nestedIncludes) continue;

        if (Array.isArray(fieldValue)) {
          entity[fieldKey] = (fieldValue as Fieldset[]).map((relatedEntity) => {
            const cleaned: Fieldset = {};
            for (const [key, val] of Object.entries(relatedEntity)) {
              if (key in nestedIncludes) {
                cleaned[key] = val;
              }
            }
            return cleaned;
          });
        } else if (typeof fieldValue === "object" && fieldValue !== null) {
          const cleaned: Fieldset = {};
          for (const [key, val] of Object.entries(fieldValue)) {
            if (key in nestedIncludes) {
              cleaned[key] = val;
            }
          }
          entity[fieldKey] = cleaned;
        }
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
  if (entities.length === 0) return ok(entities);
  if (!includes) return ok(entities);

  for (const [fieldKey, includeValue] of Object.entries(includes)) {
    const field = schema.fields[fieldKey];
    if (!field || field.dataType !== "relation") continue;
    if (!isObjectIncludes(includeValue)) continue;

    const nestedFilters = isIncludesQuery(includeValue)
      ? includeValue.filters
      : undefined;
    const nestedIncludes = isIncludesQuery(includeValue)
      ? includeValue.includes
      : includeValue;

    let relatedFilters: Filters = {};

    if (field.inverseOf) {
      const entityUids = entities.map((e) => e.uid as string).filter(Boolean);
      if (entityUids.length === 0) continue;

      relatedFilters[field.inverseOf] = { op: "in", value: entityUids };
    } else {
      const relatedIds = Array.from(collectRelationshipIds(entities, fieldKey));
      if (relatedIds.length === 0) continue;

      relatedFilters = {
        uid: { op: "in", value: relatedIds },
      };
    }

    let relatedEntitiesResult = await searchFn(
      tx,
      namespace,
      {
        ...nestedFilters,
        ...relatedFilters,
      },
      schema,
    );
    if (isErr(relatedEntitiesResult)) return relatedEntitiesResult;

    if (
      relatedEntitiesResult.data.length === 0 &&
      !field.inverseOf &&
      relatedFilters.uid
    ) {
      const keyFilters: Filters = {
        ...nestedFilters,
        key: relatedFilters.uid,
      };
      relatedEntitiesResult = await searchFn(tx, namespace, keyFilters, schema);
      if (isErr(relatedEntitiesResult)) return relatedEntitiesResult;
    }

    const resolvedRelatedEntitiesResult = await resolveIncludes(
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
    if (isErr(resolvedRelatedEntitiesResult))
      return resolvedRelatedEntitiesResult;

    mergeRelationshipData(
      entities,
      fieldKey,
      resolvedRelatedEntitiesResult.data,
      field.inverseOf,
    );
  }

  const selectedEntities = applyFieldSelection(entities, includes);

  cleanRelatedEntities(selectedEntities, includes);

  return ok(selectedEntities);
};

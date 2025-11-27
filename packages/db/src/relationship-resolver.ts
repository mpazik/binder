import { isErr, ok, type ResultAsync } from "@binder/utils";
import type {
  EntitySchema,
  FieldKey,
  Fieldset,
  Filters,
  Includes,
  NamespaceEditable,
  NodeFieldDefinition,
} from "./model";
import type { DbTransaction } from "./db.ts";

type NestedIncludes = {
  includes?: Includes;
  filters?: Filters;
};

const isNestedInclude = (
  includeValue: unknown,
): includeValue is NestedIncludes => {
  if (typeof includeValue !== "object" || includeValue === null) return false;
  return typeof includeValue !== "boolean";
};

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

const collectRelationshipIds = (
  entities: Fieldset[],
  fieldName: FieldKey,
): Set<string> => {
  const relationshipIds = new Set<string>();

  for (const entity of entities) {
    const fieldValue = getEntityFieldValue(entity, fieldName);
    if (fieldValue) {
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach((id: string) => {
          relationshipIds.add(id);
        });
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
        entity[fieldName] = fieldValue
          .map((uid) => findRelatedEntityByUid(uid, relatedEntities))
          .filter((e): e is Fieldset => e !== undefined);
      } else {
        const found = findRelatedEntityByUid(fieldValue, relatedEntities);
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
      if (isNestedInclude(includeValue)) {
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

const getNestedIncludes = (
  fieldInclude: NestedIncludes | Includes,
): Includes | undefined => {
  if ("includes" in fieldInclude) return fieldInclude.includes;
  if ("filters" in fieldInclude && Object.keys(fieldInclude).length === 1)
    return undefined;
  return fieldInclude as Includes;
};

const cleanRelatedEntities = (
  entities: Fieldset[],
  includes: Includes,
): void => {
  for (const entity of entities) {
    for (const [fieldKey, fieldValue] of Object.entries(entity)) {
      const fieldInclude = includes[fieldKey];

      if (isNestedInclude(fieldInclude)) {
        const nestedIncludes = getNestedIncludes(fieldInclude);
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
  ) => ResultAsync<Fieldset[]>,
): ResultAsync<Fieldset[]> => {
  if (entities.length === 0) return ok(entities);
  if (!includes || Object.keys(includes).length === 0) return ok(entities);

  const resolvedEntities = entities.map((entity) => ({ ...entity }));

  for (const [fieldKey, includeValue] of Object.entries(includes)) {
    const nestedInclude = isNestedInclude(includeValue);
    const shouldProcessField = includeValue === true || nestedInclude;
    if (!shouldProcessField) continue;

    const field = (schema.fields as Record<string, NodeFieldDefinition>)[
      fieldKey
    ];
    if (!field || field.dataType !== "relation") continue;

    const nestedFilters = nestedInclude
      ? (includeValue as NestedIncludes).filters
      : undefined;
    const nestedIncludes = nestedInclude
      ? getNestedIncludes(includeValue as NestedIncludes)
      : undefined;

    let relatedFilters: Filters = {};

    if (field.inverseOf) {
      const entityUids = resolvedEntities
        .map((e) => e.uid as string)
        .filter(Boolean);
      if (entityUids.length === 0) continue;

      relatedFilters[field.inverseOf] = field.allowMultiple
        ? { op: "in", value: entityUids }
        : { op: "in", value: entityUids };
    } else {
      const relatedIds = Array.from(
        collectRelationshipIds(resolvedEntities, fieldKey),
      );
      if (relatedIds.length === 0) continue;

      relatedFilters = {
        uid: { op: "in", value: relatedIds },
      };
    }

    const relatedEntitiesResult = await searchFn(tx, namespace, {
      ...nestedFilters,
      ...relatedFilters,
    });
    if (isErr(relatedEntitiesResult)) return relatedEntitiesResult;

    const resolvedRelatedEntitiesResult = await resolveIncludes(
      tx,
      relatedEntitiesResult.data,
      nestedIncludes
        ? {
            ...nestedIncludes,
            uid: true,
            ...(field.inverseOf ? { [field.inverseOf]: true } : {}),
          }
        : nestedIncludes,
      namespace,
      schema,
      searchFn,
    );
    if (isErr(resolvedRelatedEntitiesResult))
      return resolvedRelatedEntitiesResult;

    mergeRelationshipData(
      resolvedEntities,
      fieldKey,
      resolvedRelatedEntitiesResult.data,
      field.inverseOf,
    );
  }

  const selectedEntities = applyFieldSelection(resolvedEntities, includes);

  cleanRelatedEntities(selectedEntities, includes);

  return ok(selectedEntities);
};

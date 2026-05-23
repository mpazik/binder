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

type SearchFn = (
  tx: DbTransaction,
  namespace: NamespaceEditable,
  filters: Filters,
  schema: EntitySchema,
) => ResultAsync<Fieldset[]>;

// --- Field value extraction ---

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

/** Extract a relation id from a raw value (string or [key, attrs] tuple). */
const extractRelationId = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
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

// --- Merge resolved entities back into parent entities ---

const deduplicateByUid = (entities: Fieldset[]): Fieldset[] => {
  const seen = new Set<string>();
  const result: Fieldset[] = [];
  for (const e of entities) {
    const uid = e.uid as string;
    if (!seen.has(uid)) {
      seen.add(uid);
      result.push(e);
    }
  }
  return result;
};

const mergeInverseRelation = (
  entities: Fieldset[],
  fieldName: FieldKey,
  relatedEntities: Fieldset[],
  inverseFieldName: FieldKey,
  fieldIsMultiple: boolean,
): void => {
  const isSelfInverse = inverseFieldName === fieldName;

  for (const entity of entities) {
    const entityUid = entity.uid as string;
    const inverseMatching = relatedEntities.filter((related) => {
      const inverseValue = getEntityFieldValue(related, inverseFieldName);
      if (!inverseValue) return false;
      if (Array.isArray(inverseValue)) return inverseValue.includes(entityUid);
      return inverseValue === entityUid;
    });

    if (isSelfInverse && fieldIsMultiple) {
      // Self-inverse M:M: merge forward stored links with inverse matches
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
      entity[fieldName] = deduplicateByUid([
        ...forwardMatching,
        ...inverseMatching,
      ]);
    } else {
      entity[fieldName] = fieldIsMultiple
        ? inverseMatching
        : (inverseMatching[0] ?? null);
    }
  }
};

const mergeForwardRelation = (
  entities: Fieldset[],
  fieldName: FieldKey,
  relatedEntities: Fieldset[],
): void => {
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
};

// --- Phase 1: resolve relations recursively ---

const resolveRelations = async (
  tx: DbTransaction,
  entities: Fieldset[],
  includes: Includes,
  namespace: NamespaceEditable,
  schema: EntitySchema,
  searchFn: SearchFn,
): ResultAsync<void> => {
  for (const [fieldKey, includeValue] of Object.entries(includes)) {
    const field = schema.fields[fieldKey];
    if (!field || field.dataType !== "relation") continue;

    const isBooleanInverseInclude = includeValue === true && !!field.inverseOf;
    if (!isObjectIncludes(includeValue) && !isBooleanInverseInclude) continue;

    // Boolean include on inverse: resolve but don't expand nested fields
    const effectiveInclude = isBooleanInverseInclude
      ? { uid: true }
      : includeValue;

    if (
      isObjectIncludes(effectiveInclude) &&
      !isIncludesQuery(effectiveInclude) &&
      Object.keys(effectiveInclude).length === 0
    )
      continue;

    const nestedFilters = isIncludesQuery(effectiveInclude)
      ? effectiveInclude.filters
      : undefined;
    const nestedIncludes = isIncludesQuery(effectiveInclude)
      ? effectiveInclude.includes
      : isObjectIncludes(effectiveInclude)
        ? effectiveInclude
        : undefined;

    const forwardIds = Array.from(collectRelationshipIds(entities, fieldKey));
    const isSelfInverse = field.inverseOf === fieldKey;

    let relatedFilters: Filters;
    if (field.inverseOf) {
      const entityUids = entities.map((e) => e.uid as string).filter(Boolean);
      if (entityUids.length === 0 && forwardIds.length === 0) continue;
      relatedFilters = {
        [field.inverseOf]: { op: "in", value: entityUids },
      };
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

    // Fallback: try matching by key when uid lookup returned nothing
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

    if (nestedIncludes) {
      const nestedResult = await resolveRelations(
        tx,
        relatedEntitiesResult.data,
        nestedIncludes,
        namespace,
        schema,
        searchFn,
      );
      if (isErr(nestedResult)) return nestedResult;
    }

    if (field.inverseOf) {
      mergeInverseRelation(
        entities,
        fieldKey,
        relatedEntitiesResult.data,
        field.inverseOf,
        !!field.allowMultiple,
      );
    } else {
      mergeForwardRelation(entities, fieldKey, relatedEntitiesResult.data);
    }
  }

  return ok(undefined);
};

// --- Phase 2: apply field selection recursively ---

/** Collapse resolved relation entities back to flat uid strings. */
const collapseToUids = (val: FieldValue): FieldValue => {
  if (Array.isArray(val)) {
    return (val as Fieldset[]).map((v) =>
      typeof v === "object" && v !== null ? ((v as Fieldset).uid as string) : v,
    );
  }
  if (typeof val === "object" && val !== null)
    return (val as Fieldset).uid as string;
  return val;
};

const selectFieldsForEntity = (
  entity: Fieldset,
  includes: Includes,
  schema: EntitySchema,
): Fieldset => {
  const selected: Fieldset = {};
  for (const [fieldKey, includeValue] of Object.entries(includes)) {
    if (!includeValue || !(fieldKey in entity)) continue;

    const field = schema.fields[fieldKey];
    const val = entity[fieldKey];

    // Boolean include on inverse relation: collapse to flat uid strings
    if (includeValue === true && field?.inverseOf) {
      selected[fieldKey] = collapseToUids(val);
      continue;
    }

    if (!isObjectIncludes(includeValue)) {
      selected[fieldKey] = val;
      continue;
    }

    const nestedIncludes = isIncludesQuery(includeValue)
      ? includeValue.includes
      : includeValue;

    if (!nestedIncludes) {
      selected[fieldKey] = val;
      continue;
    }

    if (Array.isArray(val)) {
      selected[fieldKey] = (val as Fieldset[]).map((related) =>
        selectFieldsForEntity(related, nestedIncludes, schema),
      );
    } else if (typeof val === "object" && val !== null) {
      selected[fieldKey] = selectFieldsForEntity(
        val as Fieldset,
        nestedIncludes,
        schema,
      );
    } else {
      selected[fieldKey] = val;
    }
  }
  return selected;
};

const selectFields = (
  entities: Fieldset[],
  includes: Includes,
  schema: EntitySchema,
): Fieldset[] =>
  entities.map((entity) => selectFieldsForEntity(entity, includes, schema));

// --- Public API ---

export const resolveIncludes = async (
  tx: DbTransaction,
  entities: Fieldset[],
  includes: Includes | undefined,
  namespace: NamespaceEditable,
  schema: EntitySchema,
  searchFn: SearchFn,
): ResultAsync<Fieldset[]> => {
  if (entities.length === 0 || !includes) return ok(entities);

  const resolveResult = await resolveRelations(
    tx,
    entities,
    includes,
    namespace,
    schema,
    searchFn,
  );
  if (isErr(resolveResult)) return resolveResult;

  return ok(selectFields(entities, includes, schema));
};

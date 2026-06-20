import type {
  EntitySchema,
  FieldKey,
  FieldsetNested,
  FieldValue,
  NamespaceEditable,
  ReadonlyKnowledgeGraph,
} from "@binder/repo";
import {
  isErr,
  isObjTuple,
  isTuple,
  objTupleToTuple,
  ok,
  type ResultAsync,
} from "@binder/utils";

type ReferenceMap = Map<string, { uid: string; key: string }>;

type TransformMode = "normalized" | "formatted";

const isRelationField = (fieldKey: FieldKey, schema: EntitySchema): boolean =>
  schema.fields[fieldKey]?.dataType === "relation";

const collectReferenceValues = (
  entities: FieldsetNested[],
  schema: EntitySchema,
): Set<string> => {
  const refs = new Set<string>();

  const collect = (entity: FieldsetNested) => {
    for (const [fieldKey, value] of Object.entries(entity)) {
      if (!isRelationField(fieldKey, schema)) continue;
      if (typeof value === "string") {
        refs.add(value);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string") {
            refs.add(v);
          } else if (typeof v === "object" && v !== null) {
            collect(v as FieldsetNested);
          }
        }
      } else if (typeof value === "object" && value !== null) {
        collect(value as FieldsetNested);
      }
    }
  };

  for (const entity of entities) {
    collect(entity);
  }

  return refs;
};

const addToReferenceMap = (
  map: ReferenceMap,
  entities: FieldsetNested[],
): void => {
  for (const entity of entities) {
    const uid = entity.uid as string;
    const key = entity.key as string;
    map.set(uid, { uid, key });
    map.set(key, { uid, key });
  }
};

const buildReferenceMap = async (
  kg: ReadonlyKnowledgeGraph,
  refs: Set<string>,
): ResultAsync<ReferenceMap> => {
  if (refs.size === 0) return ok(new Map());

  const refArray = Array.from(refs);
  const map: ReferenceMap = new Map();

  const uidSearchResult = await kg.search({
    filters: { uid: { op: "in", value: refArray } },
  });

  // When the uid lookup fails, fall back to resolving every ref by key.
  if (isErr(uidSearchResult)) {
    const keySearchResult = await kg.search({
      filters: { key: { op: "in", value: refArray } },
    });
    if (isErr(keySearchResult)) return keySearchResult;
    addToReferenceMap(map, keySearchResult.data.items);
    return ok(map);
  }

  addToReferenceMap(map, uidSearchResult.data.items);

  const foundUids = new Set(
    uidSearchResult.data.items.map((e) => e.uid as string),
  );
  const remainingRefs = refArray.filter((r) => !foundUids.has(r));

  if (remainingRefs.length > 0) {
    const keySearchResult = await kg.search({
      filters: { key: { op: "in", value: remainingRefs } },
    });
    if (isErr(keySearchResult)) return keySearchResult;
    addToReferenceMap(map, keySearchResult.data.items);
  }

  return ok(map);
};

const resolveRef = (
  value: string,
  refMap: ReferenceMap,
  mode: TransformMode,
): string => {
  const ref = refMap.get(value);
  if (!ref) return value;
  return mode === "normalized" ? ref.uid : ref.key;
};

const transformValue = (
  value: FieldValue,
  refMap: ReferenceMap,
  mode: TransformMode,
): FieldValue => {
  if (typeof value === "string") {
    return resolveRef(value, refMap, mode);
  }
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v === "string") {
        return resolveRef(v, refMap, mode);
      }
      return v;
    });
  }
  return value;
};

const transformTupleItem = (
  key: string,
  attrs: unknown,
  schema: EntitySchema,
  refMap: ReferenceMap,
  mode: TransformMode,
): FieldValue => {
  const transformedAttrs =
    typeof attrs === "object" && attrs !== null && !Array.isArray(attrs)
      ? transformEntity(attrs as FieldsetNested, schema, refMap, mode)
      : attrs;

  if (mode === "normalized") {
    return [key, transformedAttrs] as FieldValue;
  }
  return { [key]: transformedAttrs } as FieldValue;
};

const transformArrayValue = (
  value: unknown[],
  schema: EntitySchema,
  refMap: ReferenceMap,
  mode: TransformMode,
  isRelation: boolean,
): FieldValue[] =>
  value.map((v) => {
    if (isRelation && typeof v === "string") {
      return resolveRef(v, refMap, mode);
    }

    if (isTuple(v)) {
      return transformTupleItem(v[0], v[1], schema, refMap, mode);
    }

    if (isObjTuple(v)) {
      const [key, attrs] = objTupleToTuple(v);
      return transformTupleItem(key, attrs, schema, refMap, mode);
    }

    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return transformEntity(v as FieldsetNested, schema, refMap, mode);
    }
    return v as FieldValue;
  });

const transformEntity = (
  entity: FieldsetNested,
  schema: EntitySchema,
  refMap: ReferenceMap,
  mode: TransformMode,
): FieldsetNested => {
  const result: FieldsetNested = {};

  for (const [fieldKey, value] of Object.entries(entity)) {
    const isRelation = isRelationField(fieldKey, schema);

    if (typeof value === "string" && isRelation) {
      result[fieldKey] = transformValue(value, refMap, mode);
    } else if (Array.isArray(value)) {
      result[fieldKey] = transformArrayValue(
        value,
        schema,
        refMap,
        mode,
        isRelation,
      );
    } else if (typeof value === "object" && value !== null) {
      result[fieldKey] = transformEntity(
        value as FieldsetNested,
        schema,
        refMap,
        mode,
      );
    } else {
      result[fieldKey] = value;
    }
  }

  return result;
};

const transformReferenceList = async (
  entities: FieldsetNested[],
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
  mode: TransformMode,
): ResultAsync<FieldsetNested[]> => {
  const refs = collectReferenceValues(entities, schema);
  const refMapResult = await buildReferenceMap(kg, refs);
  if (isErr(refMapResult)) return refMapResult;

  return ok(
    entities.map((entity) =>
      transformEntity(entity, schema, refMapResult.data, mode),
    ),
  );
};

const transformReference = async (
  entity: FieldsetNested,
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
  mode: TransformMode,
): ResultAsync<FieldsetNested> => {
  const result = await transformReferenceList([entity], schema, kg, mode);
  if (isErr(result)) return result;
  return ok(result.data[0]!);
};

export const normalizeReferences = (
  entity: FieldsetNested,
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
): ResultAsync<FieldsetNested> =>
  transformReference(entity, schema, kg, "normalized");

export const formatReferences = (
  entity: FieldsetNested,
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
): ResultAsync<FieldsetNested> =>
  transformReference(entity, schema, kg, "formatted");

export const normalizeReferencesList = (
  entities: FieldsetNested[],
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
): ResultAsync<FieldsetNested[]> =>
  transformReferenceList(entities, schema, kg, "normalized");

export const formatReferencesList = (
  entities: FieldsetNested[],
  schema: EntitySchema,
  kg: ReadonlyKnowledgeGraph,
): ResultAsync<FieldsetNested[]> =>
  transformReferenceList(entities, schema, kg, "formatted");

/** Loads the namespace schema, then formats relation references on `entity`. */
export const formatNamespaceReferences = async (
  kg: ReadonlyKnowledgeGraph,
  entity: FieldsetNested,
  namespace: NamespaceEditable,
): ResultAsync<FieldsetNested> => {
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;
  return formatReferences(entity, schemaResult.data, kg);
};

/** Loads the namespace schema, then formats relation references on `entities`. */
export const formatNamespaceReferencesList = async (
  kg: ReadonlyKnowledgeGraph,
  entities: FieldsetNested[],
  namespace: NamespaceEditable,
): ResultAsync<FieldsetNested[]> => {
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;
  return formatReferencesList(entities, schemaResult.data, kg);
};

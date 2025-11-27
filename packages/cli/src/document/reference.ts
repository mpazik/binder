import type {
  FieldKey,
  FieldsetNested,
  FieldValue,
  KnowledgeGraph,
  NodeFieldDefinition,
  NodeFieldKey,
  NodeKey,
  NodeSchema,
} from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";

type ReferenceMap = Map<string, { uid: string; key: string }>;

const isRelationField = (
  fieldKey: FieldKey,
  schema: NodeSchema,
): NodeFieldDefinition | undefined => {
  const field = schema.fields[fieldKey as NodeFieldKey];
  if (!field || field.dataType !== "relation") return undefined;
  return field;
};

const collectReferenceValues = (
  entities: FieldsetNested[],
  schema: NodeSchema,
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

const buildReferenceMap = async (
  kg: KnowledgeGraph,
  refs: Set<string>,
): ResultAsync<ReferenceMap> => {
  if (refs.size === 0) return ok(new Map());

  const refArray = Array.from(refs);
  const searchResult = await kg.search({
    filters: {
      uid: { op: "in", value: refArray },
    },
  });

  if (isErr(searchResult)) {
    const keySearchResult = await kg.search({
      filters: {
        key: { op: "in", value: refArray },
      },
    });
    if (isErr(keySearchResult)) return keySearchResult;

    const map: ReferenceMap = new Map();
    for (const entity of keySearchResult.data.items) {
      const uid = entity.uid as string;
      const key = entity.key as string;
      map.set(uid, { uid, key });
      map.set(key, { uid, key });
    }
    return ok(map);
  }

  const foundUids = new Set(
    searchResult.data.items.map((e) => e.uid as string),
  );
  const remainingRefs = refArray.filter((r) => !foundUids.has(r));

  const map: ReferenceMap = new Map();
  for (const entity of searchResult.data.items) {
    const uid = entity.uid as string;
    const key = entity.key as string;
    map.set(uid, { uid, key });
    map.set(key, { uid, key });
  }

  if (remainingRefs.length > 0) {
    const keySearchResult = await kg.search({
      filters: {
        key: { op: "in", value: remainingRefs },
      },
    });
    if (isErr(keySearchResult)) return keySearchResult;

    for (const entity of keySearchResult.data.items) {
      const uid = entity.uid as string;
      const key = entity.key as string;
      map.set(uid, { uid, key });
      map.set(key, { uid, key });
    }
  }

  return ok(map);
};

const transformValue = (
  value: FieldValue,
  refMap: ReferenceMap,
  targetField: "uid" | "key",
): FieldValue => {
  if (typeof value === "string") {
    const ref = refMap.get(value);
    return ref ? ref[targetField] : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v === "string") {
        const ref = refMap.get(v);
        return ref ? ref[targetField] : v;
      }
      return v;
    });
  }
  return value;
};

const transformEntity = (
  entity: FieldsetNested,
  schema: NodeSchema,
  refMap: ReferenceMap,
  targetField: "uid" | "key",
): FieldsetNested => {
  const result: FieldsetNested = {};

  for (const [fieldKey, value] of Object.entries(entity)) {
    if (isRelationField(fieldKey, schema)) {
      if (typeof value === "string") {
        result[fieldKey] = transformValue(value, refMap, targetField);
      } else if (Array.isArray(value)) {
        result[fieldKey] = value.map((v) => {
          if (typeof v === "string") {
            const ref = refMap.get(v);
            return ref ? ref[targetField] : v;
          }
          if (typeof v === "object" && v !== null) {
            return transformEntity(
              v as FieldsetNested,
              schema,
              refMap,
              targetField,
            );
          }
          return v;
        });
      } else if (typeof value === "object" && value !== null) {
        result[fieldKey] = transformEntity(
          value as FieldsetNested,
          schema,
          refMap,
          targetField,
        );
      } else {
        result[fieldKey] = value;
      }
    } else {
      result[fieldKey] = value;
    }
  }

  return result;
};

export const normalizeReferences = async (
  entity: FieldsetNested,
  schema: NodeSchema,
  kg: KnowledgeGraph,
): ResultAsync<FieldsetNested> => {
  const refs = collectReferenceValues([entity], schema);
  const refMapResult = await buildReferenceMap(kg, refs);
  if (isErr(refMapResult)) return refMapResult;

  return ok(transformEntity(entity, schema, refMapResult.data, "uid"));
};

export const formatReferences = async (
  entity: FieldsetNested,
  schema: NodeSchema,
  kg: KnowledgeGraph,
): ResultAsync<FieldsetNested> => {
  const refs = collectReferenceValues([entity], schema);
  const refMapResult = await buildReferenceMap(kg, refs);
  if (isErr(refMapResult)) return refMapResult;

  return ok(transformEntity(entity, schema, refMapResult.data, "key"));
};

export const normalizeReferencesList = async (
  entities: FieldsetNested[],
  schema: NodeSchema,
  kg: KnowledgeGraph,
): ResultAsync<FieldsetNested[]> => {
  const refs = collectReferenceValues(entities, schema);
  const refMapResult = await buildReferenceMap(kg, refs);
  if (isErr(refMapResult)) return refMapResult;

  return ok(
    entities.map((entity) =>
      transformEntity(entity, schema, refMapResult.data, "uid"),
    ),
  );
};

export const formatReferencesList = async (
  entities: FieldsetNested[],
  schema: NodeSchema,
  kg: KnowledgeGraph,
): ResultAsync<FieldsetNested[]> => {
  const refs = collectReferenceValues(entities, schema);
  const refMapResult = await buildReferenceMap(kg, refs);
  if (isErr(refMapResult)) return refMapResult;

  return ok(
    entities.map((entity) =>
      transformEntity(entity, schema, refMapResult.data, "key"),
    ),
  );
};

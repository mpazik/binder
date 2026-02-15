import type {
  EntitySchema,
  EntityType,
  EntityUid,
  FieldsetNested,
  RecordType,
  RecordUid,
} from "@binder/db";
import { classifyFields } from "../diff/field-classifier.ts";
import { matchEntities } from "../diff/entity-matcher.ts";
import type { ExtractedFileData } from "../document/extraction.ts";
import type { DocumentEntityContext } from "./entity-context.ts";

export type EntityMapping =
  | { status: "matched"; uid: RecordUid; type: RecordType }
  | { status: "new"; type?: RecordType };

export type EntityMappings =
  | { kind: "single"; mapping: EntityMapping }
  | { kind: "list"; mappings: EntityMapping[] }
  | { kind: "document"; mapping: EntityMapping };

const computeSingleMapping = (
  entity: FieldsetNested,
  existingEntities: FieldsetNested[],
): EntityMapping => {
  const type = entity.type as EntityType;
  const uid = entity.uid as EntityUid;

  if (uid) {
    const existing = existingEntities.find((e) => (e.uid as EntityUid) === uid);
    if (existing) {
      const existingType = existing.type as EntityType;
      if (existingType) return { status: "matched", uid, type: existingType };
    }
  }

  if (existingEntities.length === 1) {
    const existing = existingEntities[0]!;
    const existingUid = existing.uid as EntityUid;
    const existingType = existing.type as EntityType;
    if (existingUid && existingType) {
      return { status: "matched", uid: existingUid, type: existingType };
    }
  }

  return { status: "new", type };
};
const computeListMappings = (
  schema: EntitySchema,
  docEntities: FieldsetNested[],
  dbEntities: FieldsetNested[],
  queryType?: RecordType,
): EntityMapping[] => {
  const getType = (entity: FieldsetNested): RecordType | undefined =>
    (entity.type as EntityType) ?? queryType;

  if (dbEntities.length === 0) {
    return docEntities.map((e) => ({ status: "new", type: getType(e) }));
  }

  const classifications = classifyFields(schema);
  const matchResult = matchEntities(
    { schema, classifications },
    docEntities,
    dbEntities,
  );

  const mappings: EntityMapping[] = docEntities.map((entity) => ({
    status: "new" as const,
    type: getType(entity),
  }));

  for (const { newIndex, oldIndex } of matchResult.matches) {
    const oldEntity = dbEntities[oldIndex]!;
    const uid = oldEntity.uid as EntityUid;
    const type = oldEntity.type as EntityType;
    if (uid && type) {
      mappings[newIndex] = { status: "matched", uid, type };
    }
  }

  return mappings;
};
export const computeEntityMappings = (
  schema: EntitySchema,
  extracted: ExtractedFileData,
  entityContext: DocumentEntityContext,
): EntityMappings => {
  if (extracted.kind === "single" && entityContext.kind === "single") {
    return {
      kind: "single",
      mapping: computeSingleMapping(extracted.entity, entityContext.entities),
    };
  }

  if (extracted.kind === "list" && entityContext.kind === "list") {
    return {
      kind: "list",
      mappings: computeListMappings(
        schema,
        extracted.entities,
        entityContext.entities,
        entityContext.queryType,
      ),
    };
  }

  if (extracted.kind === "document" && entityContext.kind === "document") {
    return {
      kind: "document",
      mapping: computeSingleMapping(extracted.entity, entityContext.entities),
    };
  }

  return { kind: "single", mapping: { status: "new" } };
};

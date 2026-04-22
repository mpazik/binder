import type { EntityId, EntityKey, EntityType, EntityUid } from "./entity.ts";

export type RecordId = EntityId;
export type RecordUid = EntityUid;
export type RecordKey = EntityKey;
export type RecordRef = RecordId | RecordUid | RecordKey;
export type RecordType = EntityType;
export type RecordRelation = RecordUid;

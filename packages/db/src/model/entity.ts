/**
 * ## References
 * For Nodes they are stored as UIDs
 * For Configurations they are stored as keys;
 * therefore, keys for configuration entities are immutable and mandatory
 *
 * It is done for pragmatic reasons, as keys are useful for configuration debugging, and used as field keys for entities storage
 * Using keys for nodes would be impractical as there will be much more nodes, so keys would need to become verbose, it is also useful to allow to update them
 */
import { type Brand, type BrandDerived, type JsonValue } from "@binder/utils";
import { isValidUid, type Uid } from "../utils/uid.ts";

export type FieldKey = string;
export type FieldValue = JsonValue;
export type Fieldset = Record<FieldKey, FieldValue>;
export type EntityId = Brand<number, "EntityId">;
export type EntityUid = BrandDerived<Uid, "EntityUid">;
export type EntityKey = string;
export type EntityRef = EntityId | EntityUid | EntityKey;

export const emptyFieldset: Fieldset = {};

export const GENESIS_ENTITY_ID = 0 as EntityId;

export const incrementEntityId = (id: EntityId): EntityId => {
  return (id + 1) as EntityId;
};

export const entityRefType = ["id", "key", "uid"] as const;
export type EntityRefType = (typeof entityRefType)[number];

export const isEntityId = (id: EntityRef): id is EntityId =>
  typeof id === "number";

export const isEntityUid = (id: EntityRef): id is EntityUid => isValidUid(id);

export const resolveEntityRefType = (ref: EntityRef): EntityRefType => {
  if (isEntityId(ref)) return "id";
  if (isEntityUid(ref)) return "uid";
  return "key";
};

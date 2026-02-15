/**
 * ## References
 * For Records they are stored as UIDs
 * For Configurations they are stored as keys;
 * therefore, keys for configuration entities are immutable and mandatory
 *
 * It is done for pragmatic reasons, as keys are useful for configuration debugging, and used as field keys for entity storage
 * Using keys for records would be impractical as there will be much more records, so keys would need to become verbose, it is also useful to allow to update them
 */
import { type Brand, type BrandDerived } from "@binder/utils";
import { isValidUid, type Uid } from "../utils/uid.ts";
import { type Fieldset } from "./field.ts";

export type EntityId = Brand<number, "EntityId">;
export type EntityUid = BrandDerived<Uid, "EntityUid">;
export type EntityKey = Brand<string, "EntityKey">;
export type EntityType = EntityKey;
export type EntityRef = EntityId | EntityUid | EntityKey;

export const emptyFieldset: Fieldset = {};

export const GENESIS_ENTITY_ID = 0 as EntityId;

export const incrementEntityId = <ID extends EntityId>(id: ID): ID => {
  return (id + 1) as ID;
};

export const entityRefType = ["id", "key", "uid"] as const;
export type EntityRefType = (typeof entityRefType)[number];

export const isEntityId = (id: EntityRef): id is EntityId =>
  typeof id === "number";

export const isEntityUid = (id: EntityRef): id is EntityUid => isValidUid(id);

export const reservedEntityKeys = [
  "first",
  "last",
  "all",
  "none",
  "new",
  "next",
  "prev",
  "self",
  "root",
  "latest",
  "oldest",
  "count",
  "head",
] as const;

export type ReservedEntityKey = (typeof reservedEntityKeys)[number];

export const isReservedEntityKey = (key: string): key is ReservedEntityKey =>
  reservedEntityKeys.includes(key as ReservedEntityKey);

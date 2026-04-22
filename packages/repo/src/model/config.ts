import type { EntityId, EntityKey, EntityUid } from "./entity.ts";

export type ConfigId = EntityId;
export type ConfigUid = EntityUid;
export type ConfigKey = EntityKey;
export type ConfigType = ConfigKey;
export type ConfigRef = ConfigId | ConfigUid | ConfigKey;
export type ConfigRelation = ConfigKey;

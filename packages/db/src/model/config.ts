import type { Brand, BrandDerived } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";

export type ConfigId = BrandDerived<EntityId, "ConfigId">;
export type ConfigUid = BrandDerived<EntityUid, "ConfigUid">;
export type ConfigKey = BrandDerived<EntityKey, "ConfigKey">;
export type ConfigType = Brand<string, "ConfigType">;
export type ConfigRef = ConfigId | ConfigUid | ConfigKey;

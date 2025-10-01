import type { Brand, BrandDerived } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";

export type NodeId = BrandDerived<EntityId, "NodeId">;
export type NodeUid = BrandDerived<EntityUid, "NodeUid">;
export type NodeKey = BrandDerived<EntityKey, "NodeKey">;
export type NodeRef = NodeId | NodeUid | NodeKey;
export type NodeType = Brand<string, "NodeType">;

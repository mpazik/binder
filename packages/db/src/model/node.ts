import type { EntityId, EntityKey, EntityType, EntityUid } from "./entity.ts";

export type NodeId = EntityId;
export type NodeUid = EntityUid;
export type NodeKey = EntityKey;
export type NodeRef = NodeId | NodeUid | NodeKey;
export type NodeType = EntityType;
export type NodeRelation = NodeUid;

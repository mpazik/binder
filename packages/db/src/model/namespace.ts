import type { NodeId, NodeKey, NodeRef, NodeType, NodeUid } from "./node.ts";
import type {
  ConfigId,
  ConfigKey,
  ConfigRef,
  ConfigType,
  ConfigUid,
} from "./config.ts";
import type { TransactionId, TransactionRef } from "./transaction.ts";

export const entityNamespaces = ["node", "config", "transaction"] as const;
export const namespacesEditable = ["node", "config"] as const;
export type Namespace = (typeof entityNamespaces)[number];
export type NamespaceEditable = (typeof namespacesEditable)[number];

export type EntityNsId = {
  node: NodeId;
  config: ConfigId;
  transaction: TransactionId;
};
export type EntityNsUid = {
  node: NodeUid;
  config: ConfigUid;
};
export type EntityNsKey = {
  node: NodeKey;
  config: ConfigKey;
};
export type EntityNsType = {
  node: NodeType;
  config: ConfigType;
};
export type EntityNsRef = {
  node: NodeRef;
  config: ConfigRef;
  transaction: TransactionRef;
};

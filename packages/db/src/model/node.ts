import type { EntityId, EntityKey, EntityType, EntityUid } from "./entity.ts";
import { coreDataTypes, type DataTypeDefs } from "./data-type.ts";
import type { EntitySchema, FieldDef } from "./schema.ts";

export type NodeId = EntityId;
export type NodeUid = EntityUid;
export type NodeKey = EntityKey;
export type NodeRef = NodeId | NodeUid | NodeKey;
export type NodeType = EntityType;
export type NodeRelation = NodeUid;

export const nodeDataTypes = {
  ...coreDataTypes,
  option: { name: "Option", description: "Option value" },
  fileHash: { name: "File Hash", description: "SHA-256 hash of the file" },
  interval: {
    name: "Interval",
    description:
      "Format is not decided, something to store value of specific period, can be timezone relative or specific",
  },
  duration: { name: "Duration" },
  uri: {
    name: "URI",
    description: "URI reference to the record in the external system",
  },
  query: { name: "Query" },
  image: { name: "Image", description: "Image URL" },
} as const satisfies DataTypeDefs;
export type NodeDataType = keyof typeof nodeDataTypes;

export type NodeFieldDef = FieldDef<NodeDataType>;
export type NodeSchema = EntitySchema<NodeDataType>;
export const emptyNodeSchema: NodeSchema = {
  fields: {},
  types: {},
};

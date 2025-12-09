import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import {
  type EntitySchema,
  type FieldDef,
  ID_RANGE_CORE_LIMIT,
  newId,
} from "./schema.ts";
import { coreDataTypes, type DataTypeDefs } from "./data-type.ts";

/**
 * Config Namespace IDs (Stored in configTable)
 *
 * 0      16             100
 * ├──────┼─────────┼────────────►
 * │ CORE │   APP   │   USER
 * └──────┴─────────┴────────────
 *
 * CORE (0-15): Identity fields
 * APP (16-99): Built-in types (Document, Task...)
 * USER (100+): User-created types
 */

export const APP_CONFIG_ID_OFFSET = ID_RANGE_CORE_LIMIT;
export const USER_CONFIG_ID_OFFSET = 100;

export const newAppConfigId = (seq: number): ConfigId =>
  newId(seq, APP_CONFIG_ID_OFFSET);

export const newUserConfigId = (seq: number): ConfigId =>
  newId(seq, USER_CONFIG_ID_OFFSET);

export type ConfigId = EntityId;
export type ConfigUid = EntityUid;
export type ConfigKey = EntityKey;
export type ConfigType = ConfigKey;
export type ConfigRef = ConfigId | ConfigUid | ConfigKey;
export type ConfigRelation = ConfigKey;

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

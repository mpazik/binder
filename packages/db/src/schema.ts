import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Table } from "drizzle-orm";
import type { IsoTimestamp, JsonObject } from "@binder/utils";
import type {
  ConfigId,
  ConfigKey,
  ConfigType,
  ConfigUid,
  ConfigurationsChangeset,
  Namespace,
  NamespaceEditable,
  NodeId,
  NodeKey,
  NodesChangeset,
  NodeType,
  NodeUid,
  TransactionHash,
  TransactionId,
} from "./model";

export const createdAt = text("created_at").$type<IsoTimestamp>().notNull();
export const updatedAt = text("updated_at").$type<IsoTimestamp>().notNull();
export const deletedAt = text("deleted_at").$type<IsoTimestamp>();
export const name = text("name").notNull();
const version = integer("version").notNull();

export const nodeTable = sqliteTable(
  "nodes",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<NodeId>(),
    uid: text("uid").notNull().$type<NodeUid>().unique(),
    key: text("key").$type<NodeKey>(),
    type: text("type").notNull().$type<NodeType>(),
    fields: blob("fields", { mode: "json" }).notNull().$type<JsonObject>(),
    version,
    createdAt,
    updatedAt,
    deletedAt,
  },
  (table) => [
    index("node_type_idx").on(table.type),
    index("node_key_idx").on(table.key),
    index("node_created_at_idx").on(table.createdAt),
    index("node_updated_at_idx").on(table.updatedAt),
  ],
);

export const configTable = sqliteTable(
  "configurations",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<ConfigId>(),
    uid: text("uid").notNull().$type<ConfigUid>().unique(),
    key: text("key").notNull().$type<ConfigKey>(),
    type: text("type").notNull().$type<ConfigType>(),
    fields: blob("fields", { mode: "json" }).notNull().$type<JsonObject>(),
    version,
    createdAt,
    updatedAt,
    deletedAt,
  },
  (table) => [
    index("config_uid_idx").on(table.uid),
    index("config_type_idx").on(table.type),
    index("config_key_idx").on(table.key),
    index("config_created_at_idx").on(table.createdAt),
  ],
);
export const transactionTable = sqliteTable(
  "transactions",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<TransactionId>(),
    hash: text("hash").notNull().$type<TransactionHash>().unique(),
    previous: text("previous").notNull().$type<TransactionHash>(),
    configurations: blob("configurations", { mode: "json" })
      .notNull()
      .$type<ConfigurationsChangeset>(),
    nodes: blob("nodes", { mode: "json" }).notNull().$type<NodesChangeset>(),
    author: text("author").notNull(),
    fields: blob("fields", { mode: "json" }).notNull().$type<JsonObject>(),
    createdAt,
    deletedAt,
  },
  (table) => [
    index("transactions_created_at_idx").on(table.createdAt),
    index("transactions_previous_idx").on(table.previous),
  ],
);

export const editableEntityTables = {
  node: nodeTable,
  config: configTable,
} as const satisfies Record<NamespaceEditable, Table>;

export const entityTables = {
  ...editableEntityTables,
  transaction: transactionTable,
} as const satisfies Record<Namespace, Table>;

export const tableStoredFields = [
  "id",
  "uid",
  "key",
  "type",
  "version",
  "createdAt",
  "updatedAt",
  "deletedAt",
];

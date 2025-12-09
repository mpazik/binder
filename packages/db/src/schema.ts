import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql, type Table } from "drizzle-orm";
import type { IsoTimestamp, JsonObject } from "@binder/utils";
import {
  type ConfigId,
  type ConfigKey,
  type ConfigType,
  type ConfigUid,
  type ConfigurationsChangeset,
  coreIdentityFieldKeys,
  type Namespace,
  type NamespaceEditable,
  type NodeId,
  type NodeKey,
  type NodesChangeset,
  type NodeType,
  type NodeUid,
  type TransactionHash,
  type TransactionId,
} from "./model";

export const txIds = blob("tx_ids", { mode: "json" })
  .notNull()
  .$type<TransactionId[]>()
  .default(sql`'[]'`);
export const name = text("name").notNull();

export const nodeTable = sqliteTable(
  "nodes",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<NodeId>(),
    uid: text("uid").notNull().$type<NodeUid>().unique(),
    key: text("key").$type<NodeKey>().unique(),
    type: text("type").notNull().$type<NodeType>(),
    fields: blob("fields", { mode: "json" }).notNull().$type<JsonObject>(),
    txIds,
  },
  (table) => [
    index("node_type_idx").on(table.type),
    index("node_key_idx").on(table.key),
  ],
);

export const configTable = sqliteTable(
  "configurations",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<ConfigId>(),
    uid: text("uid").notNull().$type<ConfigUid>().unique(),
    key: text("key").notNull().$type<ConfigKey>().unique(),
    type: text("type").notNull().$type<ConfigType>(),
    fields: blob("fields", { mode: "json" }).notNull().$type<JsonObject>(),
    txIds,
  },
  (table) => [
    index("config_uid_idx").on(table.uid),
    index("config_type_idx").on(table.type),
    index("config_key_idx").on(table.key),
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
    createdAt: text("created_at").$type<IsoTimestamp>().notNull(),
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

export const tableStoredFields = [...coreIdentityFieldKeys, "txIds"] as const;

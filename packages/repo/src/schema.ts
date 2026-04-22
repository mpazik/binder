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
  type ConfigChangeset,
  coreIdentityFieldKeys,
  type Namespace,
  type NamespaceEditable,
  type RecordId,
  type RecordKey,
  type RecordsChangeset,
  type RecordType,
  type RecordUid,
  type TransactionHash,
  type TransactionId,
} from "./model";

export const txIds = blob("tx_ids", { mode: "json" })
  .notNull()
  .$type<TransactionId[]>()
  .default(sql`'[]'`);
export const tags = blob("tags", { mode: "json" })
  .notNull()
  .$type<string[]>()
  .default(sql`'[]'`);
export const name = text("name").notNull();
const fields = blob("fields", { mode: "json" }).notNull().$type<JsonObject>();

export const recordTable = sqliteTable(
  "records",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<RecordId>(),
    uid: text("uid").notNull().$type<RecordUid>().unique(),
    key: text("key").$type<RecordKey>().unique(),
    type: text("type").notNull().$type<RecordType>(),
    fields,
    txIds,
    tags,
  },
  (table) => [
    index("record_type_idx").on(table.type),
    index("record_key_idx").on(table.key),
  ],
);

export const configTable = sqliteTable(
  "configs",
  {
    // manually added WITHOUT ROWID as not supported by Drizzle
    id: integer("id").primaryKey().$type<ConfigId>(),
    uid: text("uid").notNull().$type<ConfigUid>().unique(),
    key: text("key").notNull().$type<ConfigKey>().unique(),
    type: text("type").notNull().$type<ConfigType>(),
    fields,
    txIds,
    tags,
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
    configs: blob("configs", { mode: "json" })
      .notNull()
      .$type<ConfigChangeset>(),
    records: blob("records", { mode: "json" })
      .notNull()
      .$type<RecordsChangeset>(),
    author: text("author").notNull(),
    fields,
    tags,
    createdAt: text("created_at").$type<IsoTimestamp>().notNull(),
  },
  (table) => [
    index("transactions_created_at_idx").on(table.createdAt),
    index("transactions_previous_idx").on(table.previous),
  ],
);

export const editableEntityTables = {
  record: recordTable,
  config: configTable,
} as const satisfies Record<NamespaceEditable, Table>;

export const entityTables = {
  ...editableEntityTables,
  transaction: transactionTable,
} as const satisfies Record<Namespace, Table>;

export const tableStoredFields = [
  ...coreIdentityFieldKeys,
  "txIds",
  "tags",
] as const;

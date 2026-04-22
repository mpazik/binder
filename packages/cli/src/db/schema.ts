import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { EntityUid, TransactionId } from "@binder/repo";
import * as dbSchema from "@binder/repo/schema";

export const cliSnapshotMetadataTable = sqliteTable(
  "cli_snapshot_metadata",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    txId: integer("tx_id").notNull().$type<TransactionId>(),
    entityUid: text("entity_uid").$type<EntityUid>(),
    mtime: integer("mtime").notNull(),
    size: integer("size").notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [
    index("cli_snapshot_path_idx").on(table.path),
    index("cli_snapshot_tx_idx").on(table.txId),
    index("cli_snapshot_entity_uid_idx").on(table.entityUid),
  ],
);

export const schema = {
  ...dbSchema,
  cliSnapshotMetadataTable,
};

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { IsoTimestamp } from "@binder/utils";
import type { TransactionId } from "@binder/db";
import * as dbSchema from "@binder/db/schema";

export const cliSnapshotMetadataTable = sqliteTable(
  "cli_snapshot_metadata",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    txId: integer("tx_id").notNull().$type<TransactionId>(),
    mtime: integer("mtime").notNull(),
    size: integer("size").notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [
    index("cli_snapshot_path_idx").on(table.path),
    index("cli_snapshot_tx_idx").on(table.txId),
  ],
);

export const schema = {
  ...dbSchema,
  cliSnapshotMetadataTable,
};

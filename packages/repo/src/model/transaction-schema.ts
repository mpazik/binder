import type { EntityId, EntityKey } from "./entity.ts";
import { type FieldDef, ID_RANGE_CORE_LIMIT, newId } from "./schema.ts";
import { coreDataTypes, type DataTypeDefs } from "./data-type.ts";

/**
 * Transaction namespace field ID ranges.
 *
 * 0       16
 * ├───────┼──────────►
 * │ CORE  │   TX
 * └───────┴──────────
 *
 * CORE [1-15]: Shared across all namespaces (see schema.ts).
 * TX   [16+]:  Transaction-specific metadata fields.
 */

export const TX_META_ID_OFFSET = ID_RANGE_CORE_LIMIT;

const newTxMetaId = (seq: number): EntityId => newId(seq, TX_META_ID_OFFSET);

export const txDataTypes = {
  ...coreDataTypes,
} as const satisfies DataTypeDefs;
export type TxDataType = keyof typeof txDataTypes;

export const txSchemaIds = {
  message: newTxMetaId(1),
  source: newTxMetaId(2),
  channel: newTxMetaId(3),
} as const;

export type TxFieldDef = FieldDef<TxDataType>;

export const txFields = {
  message: {
    id: txSchemaIds.message,
    key: "message" as EntityKey,
    name: "Message",
    dataType: "plaintext",
    plaintextFormat: "line",
    description: "Human-readable summary of the transaction.",
  },
  source: {
    id: txSchemaIds.source,
    key: "source" as EntityKey,
    name: "Source",
    dataType: "plaintext",
    plaintextFormat: "identifier",
    description:
      "Reference to a source record (uid or key) that originated this change.",
  },
  channel: {
    id: txSchemaIds.channel,
    key: "channel" as EntityKey,
    name: "Channel",
    dataType: "plaintext",
    plaintextFormat: "identifier",
    description:
      "Origin channel that created the transaction: cli, lsp, mcp, agent, engine.",
  },
} as const satisfies Record<string, TxFieldDef>;

export type TxFieldKey = keyof typeof txFields;

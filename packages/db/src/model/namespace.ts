import type {
  RecordId,
  RecordKey,
  RecordRef,
  RecordType,
  RecordUid,
} from "./record.ts";
import type {
  ConfigId,
  ConfigKey,
  ConfigRef,
  ConfigType,
  ConfigUid,
  RecordDataType,
} from "./config.ts";
import type { TransactionId, TransactionRef } from "./transaction.ts";
import type { CoreDataType } from "./data-type.ts";
import type { EntitySchema } from "./schema.ts";
import type { ConfigDataType } from "./system.ts";

export const entityNamespaces = ["record", "config", "transaction"] as const;
export const namespacesEditable = ["record", "config"] as const;
export type Namespace = (typeof entityNamespaces)[number];
export type NamespaceEditable = (typeof namespacesEditable)[number];

export type EntityNsId = {
  record: RecordId;
  config: ConfigId;
  transaction: TransactionId;
};
export type EntityNsUid = {
  record: RecordUid;
  config: ConfigUid;
};
export type EntityNsKey = {
  record: RecordKey;
  config: ConfigKey;
};
export type EntityNsType = {
  record: RecordType;
  config: ConfigType;
};
export type EntityNsRef = {
  record: RecordRef;
  config: ConfigRef;
  transaction: TransactionRef;
};
export type DataTypeNs = {
  record: RecordDataType;
  config: ConfigDataType;
  transaction: CoreDataType;
};

export type NamespaceSchema<N extends Namespace> = EntitySchema<DataTypeNs[N]>;

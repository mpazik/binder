import {
  type BrandDerived,
  filterObjectValues,
  type IsoTimestamp,
  mapObjectValues,
} from "@binder/utils";
import { hashString, hashToBase64Uri } from "../utils/hash.ts";
import { type EntityId, type EntityKey, GENESIS_ENTITY_ID } from "./entity.ts";
import type {
  ConfigChangeset,
  FieldChangeset,
  RecordsChangeset,
} from "./changeset.ts";
import {
  canonicalizeEntitiesChangeset,
  inverseChangeset,
  squashChangesets,
} from "./changeset.ts";

import type { ConfigSchema } from "./system.ts";
import type { RecordSchema } from "./config.ts";

export type TransactionId = BrandDerived<EntityId, "TransactionId">;
export type TransactionHash = BrandDerived<EntityKey, "TransactionHash">;
export type TransactionRef = TransactionId | TransactionHash;

export const isTransactionId = (ref: TransactionRef): ref is TransactionId =>
  typeof ref === "number";

export type Transaction = {
  id: TransactionId;
  hash: TransactionHash;
  previous: TransactionHash;
  records: RecordsChangeset;
  configs: ConfigChangeset;
  author: string;
  createdAt: IsoTimestamp;
};

type CanonicalTransaction = {
  previous: TransactionHash;
  createdAt: IsoTimestamp;
  author: string;
  records?: RecordsChangeset;
  configs?: ConfigChangeset;
};

const isNonEmptyChangeset = (changeset: FieldChangeset): boolean =>
  Object.keys(changeset).length > 0;

export const transactionToCanonical = (
  configSchema: ConfigSchema,
  recordSchema: RecordSchema,
  tx: Pick<
    Transaction,
    "previous" | "author" | "createdAt" | "records" | "configs"
  >,
): CanonicalTransaction => {
  const records = filterObjectValues(
    canonicalizeEntitiesChangeset(recordSchema, tx.records),
    isNonEmptyChangeset,
  );
  const configs = filterObjectValues(
    canonicalizeEntitiesChangeset(configSchema, tx.configs),
    isNonEmptyChangeset,
  );

  return {
    previous: tx.previous,
    createdAt: tx.createdAt,
    author: tx.author,
    ...(Object.keys(records).length > 0 && { records }),
    ...(Object.keys(configs).length > 0 && { configs }),
  };
};

export const hashTransaction = async (
  canonical: CanonicalTransaction,
): Promise<TransactionHash> =>
  hashToBase64Uri(
    await hashString(JSON.stringify(canonical)),
  ) as TransactionHash;

export const withHashTransaction = async (
  configSchema: ConfigSchema,
  recordSchema: RecordSchema,
  tx: Pick<
    Transaction,
    "previous" | "author" | "createdAt" | "records" | "configs"
  >,
  id: TransactionId,
): Promise<Transaction> => {
  const canonical = transactionToCanonical(configSchema, recordSchema, tx);
  return {
    id,
    hash: await hashTransaction(canonical),
    previous: canonical.previous,
    createdAt: canonical.createdAt,
    author: canonical.author,
    records: canonical.records ?? {},
    configs: canonical.configs ?? {},
  };
};

export type GraphVersion = {
  id: TransactionId;
  hash: TransactionHash;
  updatedAt: IsoTimestamp;
};

export const versionFromTransaction = (tx: Transaction): GraphVersion => {
  return {
    id: tx.id,
    hash: tx.hash,
    updatedAt: tx.createdAt,
  };
};

export const GENESIS_VERSION: GraphVersion = {
  id: GENESIS_ENTITY_ID as TransactionId,
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as TransactionHash,
  updatedAt: "2025-10-01T00:00:00.000Z" as IsoTimestamp,
};

export const invertTransaction = (transaction: Transaction): Transaction => ({
  ...transaction,
  records: mapObjectValues(transaction.records, inverseChangeset),
  configs: mapObjectValues(transaction.configs, inverseChangeset),
});

export const shortTransactionHash = (
  tx: Transaction,
  length: number = 8,
): string => tx.hash.slice(0, length);

export const squashTransactions = async (
  transactions: Transaction[],
  recordSchema: RecordSchema,
  configSchema: ConfigSchema,
): Promise<Transaction> => {
  const oldest = transactions[0]!;
  const newest = transactions[transactions.length - 1]!;

  const squashedRecords = {} as RecordsChangeset;
  const squashedConfigs = {} as ConfigChangeset;

  for (const tx of transactions) {
    for (const [uid, changeset] of Object.entries(tx.records)) {
      const recordUid = uid as keyof RecordsChangeset;
      squashedRecords[recordUid] = squashedRecords[recordUid]
        ? squashChangesets(squashedRecords[recordUid]!, changeset)
        : changeset;
    }

    for (const [uid, changeset] of Object.entries(tx.configs)) {
      const configUid = uid as keyof ConfigChangeset;
      squashedConfigs[configUid] = squashedConfigs[configUid]
        ? squashChangesets(squashedConfigs[configUid]!, changeset)
        : changeset;
    }
  }

  return withHashTransaction(
    configSchema,
    recordSchema,
    {
      previous: oldest.previous,
      author: newest.author,
      createdAt: newest.createdAt,
      records: squashedRecords,
      configs: squashedConfigs,
    },
    oldest.id,
  );
};

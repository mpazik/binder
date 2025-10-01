import {
  type Brand,
  type BrandDerived,
  type IsoTimestamp,
  pick,
} from "@binder/utils";
import { z } from "zod";
import { hashString, hashToHex } from "../utils/hash.ts";
import { type EntityId, GENESIS_ENTITY_ID } from "./entity.ts";
import type {
  ChangesetsInput,
  ConfigurationsChangeset,
  NodesChangeset,
} from "./changeset.ts";

export type TransactionId = BrandDerived<EntityId, "TransactionId">;
export type TransactionHash = Brand<string, "TransactionHash">;
export type TransactionRef = TransactionId | TransactionHash;

export const isTransactionId = (ref: TransactionRef): ref is TransactionId =>
  typeof ref === "number";

export type Transaction = {
  id: TransactionId;
  hash: TransactionHash;
  previous: TransactionHash;
  nodes: NodesChangeset;
  configurations: ConfigurationsChangeset;
  author: string;
  createdAt: IsoTimestamp;
};

export const TransactionInput = z.object({
  author: z.string(),
  createdAt: z
    .string()
    .transform((val) => val as IsoTimestamp | undefined)
    .optional(),
  nodes: z
    .array(z.record(z.string(), z.unknown()))
    .transform((val) => val as ChangesetsInput<"node">),
  configurations: z
    .array(z.record(z.string(), z.unknown()))
    .transform((val) => val as ChangesetsInput<"config">),
});

export type TransactionInput = z.infer<typeof TransactionInput>;

type CanonicalTransaction = {
  previous: TransactionHash;
  nodes: NodesChangeset;
  configurations: ConfigurationsChangeset;
  createdAt: IsoTimestamp;
};

export const transactionToCanonical = (
  tx: Pick<
    Transaction,
    "previous" | "author" | "createdAt" | "nodes" | "configurations"
  >,
): CanonicalTransaction => {
  return pick(tx, [
    "previous",
    "author",
    "createdAt",
    "nodes",
    "configurations",
  ]);
};

export const hashTransaction = async (
  canonical: CanonicalTransaction,
): Promise<TransactionHash> => {
  const json = JSON.stringify(canonical);
  const hash = hashToHex(await hashString(json));
  return hash as TransactionHash;
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
  hash: "0".repeat(64) as TransactionHash,
  updatedAt: "2025-10-01T00:00:00.000Z" as IsoTimestamp,
};

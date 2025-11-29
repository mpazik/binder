import {
  type Brand,
  type BrandDerived,
  filterObjectValues,
  type IsoTimestamp,
  mapObjectValues,
} from "@binder/utils";
import { z } from "zod";
import { hashString, hashToBase64Uri } from "../utils/hash.ts";
import { type EntityId, GENESIS_ENTITY_ID } from "./entity.ts";
import type {
  ChangesetsInput,
  ConfigurationsChangeset,
  FieldChangeset,
  NodesChangeset,
} from "./changeset.ts";
import squashChangesets, {
  canonicalizeEntitiesChangeset,
  inverseChangeset,
} from "./changeset.ts";
import { type ConfigSchema, type NodeSchema } from "./schema.ts";

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
    .transform((val) => val as ChangesetsInput<"node">)
    .optional(),
  configurations: z
    .array(z.record(z.string(), z.unknown()))
    .transform((val) => val as ChangesetsInput<"config">)
    .optional(),
});

export type TransactionInput = z.infer<typeof TransactionInput>;

type CanonicalTransaction = {
  previous: TransactionHash;
  createdAt: IsoTimestamp;
  author: string;
  nodes?: NodesChangeset;
  configurations?: ConfigurationsChangeset;
};

const isNonEmptyChangeset = (changeset: FieldChangeset): boolean =>
  Object.keys(changeset).length > 0;

export const transactionToCanonical = (
  configSchema: ConfigSchema,
  nodeSchema: NodeSchema,
  tx: Pick<
    Transaction,
    "previous" | "author" | "createdAt" | "nodes" | "configurations"
  >,
): CanonicalTransaction => {
  const nodes = filterObjectValues(
    canonicalizeEntitiesChangeset(nodeSchema, tx.nodes),
    isNonEmptyChangeset,
  );
  const configurations = filterObjectValues(
    canonicalizeEntitiesChangeset(configSchema, tx.configurations),
    isNonEmptyChangeset,
  );

  return {
    previous: tx.previous,
    createdAt: tx.createdAt,
    author: tx.author,
    ...(Object.keys(nodes).length > 0 && { nodes }),
    ...(Object.keys(configurations).length > 0 && { configurations }),
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
  nodeSchema: NodeSchema,
  tx: Pick<
    Transaction,
    "previous" | "author" | "createdAt" | "nodes" | "configurations"
  >,
  id: TransactionId,
): Promise<Transaction> => {
  const canonical = transactionToCanonical(configSchema, nodeSchema, tx);
  return {
    id,
    hash: await hashTransaction(canonical),
    previous: canonical.previous,
    createdAt: canonical.createdAt,
    author: canonical.author,
    nodes: canonical.nodes ?? {},
    configurations: canonical.configurations ?? {},
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
  nodes: mapObjectValues(transaction.nodes, inverseChangeset),
  configurations: mapObjectValues(transaction.configurations, inverseChangeset),
});

export const shortTransactionHash = (
  tx: Transaction,
  length: number = 8,
): string => tx.hash.slice(0, length);

export const squashTransactions = async (
  transactions: Transaction[],
  nodeSchema: NodeSchema,
  configSchema: ConfigSchema,
): Promise<Transaction> => {
  const oldest = transactions[0]!;
  const newest = transactions[transactions.length - 1]!;

  const squashedNodes = {} as NodesChangeset;
  const squashedConfigurations = {} as ConfigurationsChangeset;

  for (const tx of transactions) {
    for (const [uid, changeset] of Object.entries(tx.nodes)) {
      const nodeUid = uid as keyof NodesChangeset;
      squashedNodes[nodeUid] = squashedNodes[nodeUid]
        ? squashChangesets(squashedNodes[nodeUid]!, changeset)
        : changeset;
    }

    for (const [uid, changeset] of Object.entries(tx.configurations)) {
      const configUid = uid as keyof ConfigurationsChangeset;
      squashedConfigurations[configUid] = squashedConfigurations[configUid]
        ? squashChangesets(squashedConfigurations[configUid]!, changeset)
        : changeset;
    }
  }

  return withHashTransaction(
    configSchema,
    nodeSchema,
    {
      previous: oldest.previous,
      author: newest.author,
      createdAt: newest.createdAt,
      nodes: squashedNodes,
      configurations: squashedConfigurations,
    },
    oldest.id,
  );
};

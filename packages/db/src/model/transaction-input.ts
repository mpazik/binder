import { z } from "zod";
import type { IsoTimestamp } from "@binder/utils";
import {
  type ChangesetsInput,
  changesetToInput,
  type EntityChangesetInput,
} from "./changeset-input.ts";
import type { NamespaceEditable } from "./namespace.ts";
import type { Transaction } from "./transaction.ts";

export const TransactionInputSchema = z.object({
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
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const createTransactionInput = (
  author: string,
  namespace: NamespaceEditable,
  changesets: EntityChangesetInput<NamespaceEditable>[],
): TransactionInput =>
  namespace === "node"
    ? { author, nodes: changesets }
    : { author, configurations: changesets };

export const transactionToInput = (tx: Transaction): TransactionInput => {
  const nodes: EntityChangesetInput<"node">[] = [];
  for (const [uid, changeset] of Object.entries(tx.nodes)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      nodes.push(input as EntityChangesetInput<"node">);
    } else {
      nodes.push({ $ref: uid, ...input } as EntityChangesetInput<"node">);
    }
  }

  const configurations: EntityChangesetInput<"config">[] = [];
  for (const [key, changeset] of Object.entries(tx.configurations)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      configurations.push(input as EntityChangesetInput<"config">);
    } else {
      configurations.push({
        $ref: key,
        ...input,
      } as EntityChangesetInput<"config">);
    }
  }

  return {
    author: tx.author,
    createdAt: tx.createdAt,
    ...(nodes.length > 0 && { nodes }),
    ...(configurations.length > 0 && { configurations }),
  };
};

export const normalizeTransactionInput = (
  input: TransactionInput,
): TransactionInput => ({
  author: input.author,
  ...(input.createdAt && { createdAt: input.createdAt }),
  ...(input.nodes && input.nodes.length > 0 && { nodes: input.nodes }),
  ...(input.configurations &&
    input.configurations.length > 0 && {
      configurations: input.configurations,
    }),
});

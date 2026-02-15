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
  records: z
    .array(z.record(z.string(), z.unknown()))
    .transform((val) => val as ChangesetsInput<"record">)
    .optional(),
  configs: z
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
  namespace === "record"
    ? { author, records: changesets }
    : { author, configs: changesets };

export const transactionToInput = (tx: Transaction): TransactionInput => {
  const records: EntityChangesetInput<"record">[] = [];
  for (const [uid, changeset] of Object.entries(tx.records)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      records.push(input as EntityChangesetInput<"record">);
    } else {
      records.push({ $ref: uid, ...input } as EntityChangesetInput<"record">);
    }
  }

  const configs: EntityChangesetInput<"config">[] = [];
  for (const [key, changeset] of Object.entries(tx.configs)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      configs.push(input as EntityChangesetInput<"config">);
    } else {
      configs.push({
        $ref: key,
        ...input,
      } as EntityChangesetInput<"config">);
    }
  }

  return {
    author: tx.author,
    createdAt: tx.createdAt,
    ...(records.length > 0 && { records }),
    ...(configs.length > 0 && { configs }),
  };
};

export const normalizeTransactionInput = (
  input: TransactionInput,
): TransactionInput => ({
  author: input.author,
  ...(input.createdAt && { createdAt: input.createdAt }),
  ...(input.records && input.records.length > 0 && { records: input.records }),
  ...(input.configs &&
    input.configs.length > 0 && {
      configs: input.configs,
    }),
});

import { z } from "zod";
import type { IsoTimestamp } from "@binder/utils";
import {
  type ChangesetsInput,
  changesetToInput,
  type EntityChangesetInput,
} from "./changeset-input.ts";
import type { FieldChangeset } from "./changeset.ts";
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
  tags: z.array(z.string()).optional(),
  message: z.string().optional(),
  source: z.string().optional(),
  channel: z.string().optional(),
});
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

/**
 * Build a {@link TransactionInput} targeting a single namespace with optional metadata.
 * Convenience wrapper used by CLI commands to construct inputs from parsed arguments.
 */
export const createTransactionInput = (
  author: string,
  namespace: NamespaceEditable,
  changesets: EntityChangesetInput<NamespaceEditable>[],
  tags?: string[],
  message?: string,
  source?: string,
  channel?: string,
): TransactionInput => ({
  author,
  ...(namespace === "record"
    ? { records: changesets }
    : { configs: changesets }),
  ...(tags && { tags }),
  ...(message && { message }),
  ...(source && { source }),
  ...(channel && { channel }),
});

const changesetsToInputs = <N extends NamespaceEditable>(
  changesets: Record<string, FieldChangeset>,
): EntityChangesetInput<N>[] =>
  Object.entries(changesets).map(([ref, changeset]) => {
    const input = changesetToInput(changeset);
    return (
      "type" in input ? input : { $ref: ref, ...input }
    ) as EntityChangesetInput<N>;
  });

export const transactionToInput = (tx: Transaction): TransactionInput => {
  const records = changesetsToInputs<"record">(tx.records);
  const configs = changesetsToInputs<"config">(tx.configs);

  return {
    author: tx.author,
    createdAt: tx.createdAt,
    ...(records.length > 0 && { records }),
    ...(configs.length > 0 && { configs }),
    ...(tx.tags.length > 0 && { tags: tx.tags }),
    ...(tx.message !== undefined && { message: tx.message }),
    ...(tx.source !== undefined && { source: tx.source }),
    ...(tx.channel !== undefined && { channel: tx.channel }),
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
  ...(input.tags && input.tags.length > 0 && { tags: input.tags }),
  ...(input.message !== undefined && { message: input.message }),
  ...(input.source !== undefined && { source: input.source }),
  ...(input.channel !== undefined && { channel: input.channel }),
});

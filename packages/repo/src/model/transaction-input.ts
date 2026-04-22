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

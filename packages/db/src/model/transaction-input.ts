import { z } from "zod";
import type { IsoTimestamp } from "@binder/utils";
import type {
  ChangesetsInput,
  EntityChangesetInput,
} from "./changeset-input.ts";
import type { NamespaceEditable } from "./namespace.ts";

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
    ? { author, nodes: changesets, configurations: [] }
    : { author, nodes: [], configurations: changesets };

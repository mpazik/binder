import { z } from "zod";
import type { IsoTimestamp } from "@binder/utils";
import type { ChangesetsInput } from "./changeset-input.ts";

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

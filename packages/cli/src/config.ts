import { z } from "zod";

const DEFAULT_DOCS_DIR = "./docs";
const DEFAULT_AUTHOR = "cli-user";
export const CONFIG_PATH = "./binder.yaml";
export const BINDER_DIR = "./.binder";
export const DB_PATH = `${BINDER_DIR}/binder.db`;
export const TRANSACTION_LOG_PATH = `${BINDER_DIR}/log.jsonl`;

export const BinderConfigSchema = z.object({
  author: z.string().default(DEFAULT_AUTHOR),
  docsPath: z.string().default(DEFAULT_DOCS_DIR),
});

export type BinderConfig = z.infer<typeof BinderConfigSchema>;

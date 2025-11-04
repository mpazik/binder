import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import { createError, err, ok, type Result } from "@binder/utils";

const DEFAULT_DOCS_DIR = "./docs";
const DEFAULT_AUTHOR = "cli-user";
export const DEFAULT_DOCS_PATH = "docs";
export const CONFIG_FILE = "config.yaml";
export const BINDER_DIR = ".binder";
export const DB_FILE = "binder.db";
export const TRANSACTION_LOG_FILE = "log.jsonl";
export const UNDO_LOG_FILE = "undo.jsonl";

export const BinderConfigSchema = z.object({
  author: z.string().default(DEFAULT_AUTHOR),
  docsPath: z.string().default(DEFAULT_DOCS_DIR),
  dynamicDirectories: z
    .array(
      z.object({
        path: z.string(),
        query: z.string(),
        template: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type BinderConfig = z.infer<typeof BinderConfigSchema>;

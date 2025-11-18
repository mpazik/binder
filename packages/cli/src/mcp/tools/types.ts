import { type ResultAsync } from "@binder/utils";
import type { ZodSchema } from "zod";
import type { KnowledgeGraph } from "@binder/db";
import type { Logger } from "../../log.ts";
import type { KnowledgeGraphReadonly } from "../../bootstrap.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import type { AppConfig } from "../../config.ts";

export type McpToolContext = {
  abortSignal: AbortSignal;
  kg: KnowledgeGraphReadonly;
  fs: FileSystem;
  log: Logger;
  config: AppConfig;
};

type McpToolAnnotation = {
  title?: string;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openToWorld?: boolean;
};

export type ToolMetadata = {
  [key: string]: unknown;
};
export type McpTool<
  Args = Record<string, unknown>,
  Out = Record<string, unknown>,
  M extends ToolMetadata = ToolMetadata,
> = {
  name: string;
  description: string;
  parameters: ZodSchema<Args>;
  output?: ZodSchema<Out>;
  annotation: McpToolAnnotation;
  execute(
    args: Args,
    context: McpToolContext,
  ): ResultAsync<{
    metadata: M;
    output: string;
    structuredData?: Out;
  }>;
};

export function defineTool<Args extends object, Result extends ToolMetadata>(
  input: McpTool<Args, Result>,
): McpTool<Args, Result> {
  return input;
}

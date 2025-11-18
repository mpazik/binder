import type { JsonRpcResultAsync } from "@binder/utils";
import type { KnowledgeGraph } from "@binder/db";
import type { KnowledgeGraphReadonly } from "../bootstrap.ts";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { AppConfig } from "../config.ts";

export type McpContext = {
  kg: KnowledgeGraphReadonly;
  log: Logger;
  config: AppConfig;
  fs: FileSystem;
};

export type McpHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  context: McpContext,
) => JsonRpcResultAsync<TResult>;

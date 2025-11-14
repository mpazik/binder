import type { JsonRpcResultAsync } from "@binder/utils";
import type { KnowledgeGraph } from "@binder/db";
import type { Config, KnowledgeGraphReadonly } from "../bootstrap.ts";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";

export type McpContext = {
  kg: KnowledgeGraphReadonly;
  log: Logger;
  config: Config;
  fs: FileSystem;
};

export type McpHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  context: McpContext,
) => JsonRpcResultAsync<TResult>;

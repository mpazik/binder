import {
  createJsonRpcError,
  err,
  isErr,
  JSONRPC_ERRORS,
  type JsonRpcResultAsync,
  ok,
} from "@binder/utils";
import * as z from "zod";
import {
  type CallToolRequest,
  type CallToolResult,
  ErrorCode,
  type TextContent,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpHandler } from "./types.ts";
import { handleListResources, handleReadResource } from "./resources.ts";
import type { McpToolContext } from "./tools/types.ts";
import { getToolsForRequest } from "./tools/index.ts";

export const getToolsForMcp = (): Tool[] => {
  const toolsToUse = getToolsForRequest();
  return toolsToUse.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.parameters) as any,
    outputSchema: tool.output
      ? (z.toJSONSchema(tool.output) as any)
      : undefined,
  }));
};

export const executeMcpServerTool = async (
  params: CallToolRequest["params"],
  context: McpToolContext,
): JsonRpcResultAsync<CallToolResult> => {
  const availableTools = getToolsForRequest();
  const tool = availableTools.find((t) => t.name === params.name);
  if (!tool) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.METHOD_NOT_FOUND,
        `Tool not found: ${params.name}`,
      ),
    );
  }

  const parseResult = tool.parameters.safeParse(params.arguments);

  if (!parseResult.success) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INVALID_PARAMS,
        "Invalid parameters",
        JSON.stringify(parseResult.error.issues),
      ),
    );
  }

  const result = await tool.execute(parseResult.data, context);
  if (isErr(result)) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INTERNAL_ERROR,
        "Tool execution failed",
        result.error.message,
      ),
    );
  }

  return ok({
    content: [
      {
        type: "text" as const,
        text: result.data.output,
      } as TextContent,
    ],
    structuredContent: result.data.structuredData,
  });
};

export const handleToolsCall: McpHandler<
  CallToolRequest["params"],
  CallToolResult
> = async (params, context) => {
  if (!params.name) {
    return err(
      createJsonRpcError(ErrorCode.InvalidParams, "Tool name is required"),
    );
  }

  return executeMcpServerTool(params, {
    ...context,
    abortSignal: new AbortController().signal,
  });
};

export const toolHandlers: Record<string, McpHandler<any, any>> = {
  "tools/list": async (_, context) => ok({ tools: getToolsForMcp() }),
  "tools/call": handleToolsCall,
  "resources/list": handleListResources,
  "resources/read": handleReadResource,
};

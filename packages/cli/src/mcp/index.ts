import {
  createJsonRpcError,
  createJsonRpcErrorResponse,
  createJsonRpcOkResponse,
  err,
  isErr,
  JSONRPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  ok,
} from "@binder/utils";
import {
  ErrorCode,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpContext, McpHandler } from "./types";
import { toolHandlers } from "./tools.ts";

const handleInitialize: McpHandler<any, any> = async (params) => {
  const initParams = params as { protocolVersion: string };
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(initParams.protocolVersion)) {
    return err(
      createJsonRpcError(
        ErrorCode.InvalidParams,
        `Unsupported protocol version: ${initParams.protocolVersion}. Supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      ),
    );
  }

  return ok({
    protocolVersion: initParams.protocolVersion,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: "Binder",
      version: "0.1.0",
    },
  });
};

const methodHandlers: Record<string, McpHandler<any, any>> = {
  initialize: handleInitialize,
  ...toolHandlers,
};

export const processRequest = async (
  context: McpContext,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> => {
  const { method, params, id = null } = request;

  const { log } = context;
  log.debug("MCP request", { method, id });

  if (method === "notifications/initialized") {
    log.info("Client initialized");
    return createJsonRpcOkResponse({}, id ?? null);
  }

  if (request.jsonrpc !== "2.0") {
    return createJsonRpcErrorResponse(
      createJsonRpcError(
        JSONRPC_ERRORS.INVALID_REQUEST,
        "Invalid JSON-RPC version",
      ),
      id,
    );
  }

  const handler = methodHandlers[method];
  if (!handler) {
    return createJsonRpcErrorResponse(
      createJsonRpcError(
        JSONRPC_ERRORS.METHOD_NOT_FOUND,
        `Method not found: ${method}`,
      ),
      id,
    );
  }

  const result = await handler(params, context);
  if (isErr(result)) {
    log.error("MCP error", { method, error: result.error });
    return createJsonRpcErrorResponse(result.error, id ?? null);
  }

  return createJsonRpcOkResponse(result.data, id ?? null);
};

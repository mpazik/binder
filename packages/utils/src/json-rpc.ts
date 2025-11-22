import { err, ok, type Result, tryCatch, isOk } from "./result";
import { isErr } from "./result";
import { errorToObject } from "./error";
import { parseIsoTimestamps } from "./time";
import type { JsonObject } from "./json";

const JSONRPC_VERSION = "2.0";

export type JsonRpcId = string | number | null;
export const createJsonRpcId = (): JsonRpcId => {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

export type JsonRpcRequest<TParams = unknown> = {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: TParams;
  id?: JsonRpcId; // it is a notification is id is undefined
};

export type JsonRpcOkResponse<TResult = unknown> = {
  jsonrpc: typeof JSONRPC_VERSION;
  result: TResult;
  id: JsonRpcId;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export const reportJsonRpcError = (error: JsonRpcError) => {
  console.error(
    `🔴${error.code}: ${error.message}`,
    JSON.stringify(error.data, null, 2),
  );
};

export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSONRPC_VERSION;
  error: JsonRpcError;
  id: JsonRpcId;
};

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcOkResponse<TResult>
  | JsonRpcErrorResponse;

export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export const createJsonRpcError = (
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError => ({
  code,
  message,
  data,
});

export const createJsonRpcRequest = <TParams = unknown>(
  method: string,
  params?: TParams,
  id?: JsonRpcId,
): JsonRpcRequest<TParams> => ({
  jsonrpc: JSONRPC_VERSION,
  method,
  ...(params !== undefined && { params }),
  ...(id !== undefined && { id }),
});

export const createJsonRpcNotification = <TParams = unknown>(
  method: string,
  params?: TParams,
) => ({
  jsonrpc: JSONRPC_VERSION,
  method,
  ...(params !== undefined && { params }),
});

export const createJsonRpcOkResponse = <TResult = unknown>(
  result: TResult,
  id: JsonRpcId,
): JsonRpcOkResponse<TResult> => ({
  jsonrpc: JSONRPC_VERSION,
  result,
  id,
});

export const createJsonRpcErrorResponse = (
  error: JsonRpcError,
  id: JsonRpcId,
): JsonRpcErrorResponse => ({
  jsonrpc: JSONRPC_VERSION,
  error,
  id,
});

export const isJsonRpcRequest = (obj: unknown): obj is JsonRpcRequest => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    obj.jsonrpc === JSONRPC_VERSION &&
    "method" in obj &&
    typeof obj.method === "string"
  );
};

export const isJsonRpcResponse = (obj: unknown): obj is JsonRpcOkResponse => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    obj.jsonrpc === JSONRPC_VERSION
  );
};

export const isJsonRpcErrorResponse = (
  response: JsonRpcResponse,
): response is JsonRpcErrorResponse => "error" in response;

export const isJsonRpcNotification = (req: JsonRpcRequest): boolean => {
  return req.id === undefined;
};

export type JsonRpcResult<T = unknown> = Result<T, JsonRpcError>;
export type JsonRpcResultAsync<T = unknown> = Promise<JsonRpcResult<T>>;

export const resultToJsonRpcResponse = <T>(
  result: JsonRpcResult<T>,
  id: JsonRpcId,
): JsonRpcResponse<T> =>
  isErr(result)
    ? createJsonRpcErrorResponse(result.error, id)
    : createJsonRpcOkResponse(result.data, id);

export const jsonRpcResponseToResult = <T>(
  response: JsonRpcResponse<T>,
): JsonRpcResult<T> =>
  isJsonRpcErrorResponse(response) ? err(response.error) : ok(response.result);

export const resultToJsonRpcResult = <T>(
  result: Result<T>,
  code = JSONRPC_ERRORS.INTERNAL_ERROR,
): JsonRpcResult<T> =>
  isErr(result)
    ? err(
        createJsonRpcError(code, result.error.key, {
          ...result.error.data,
          details: result.error.message,
        }),
      )
    : ok(result.data);
/**
 * JSON-RPC over HTTP
 */

export type JsonRpcFetchOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  skipDateParsing?: boolean;
};

export const jsonRpcFetch = async <TResult = unknown, TParams = unknown>(
  url: string,
  method: string,
  params?: TParams,
  options?: JsonRpcFetchOptions,
  id?: JsonRpcId,
): Promise<JsonRpcResult<TResult>> => {
  const reqId = id ?? createJsonRpcId();
  const request = createJsonRpcRequest(method, params, reqId);

  const controller = new AbortController();

  const fetchResult = await tryCatch(async () => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify(request),
      signal: options?.signal || controller.signal,
    });
  });

  if (!isOk(fetchResult)) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INTERNAL_ERROR,
        "Network error",
        errorToObject(fetchResult.error),
      ),
    );
  }

  const response = fetchResult.data;

  if (!response.ok) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INTERNAL_ERROR,
        `HTTP ${response.status}: ${response.statusText}`,
        { status: response.status, statusText: response.statusText },
      ),
    );
  }

  const contentType = response.headers.get("content-type") || "";

  let responseData: JsonRpcResponse<TResult>;

  if (contentType.includes("text/event-stream")) {
    return err(
      createJsonRpcError(JSONRPC_ERRORS.INVALID_REQUEST, "SSE not supported"),
    );
  } else {
    const jsonResult = await tryCatch(async () => {
      return response.json() as Promise<JsonRpcResponse<TResult>>;
    });

    if (!isOk(jsonResult)) {
      return err(
        createJsonRpcError(
          JSONRPC_ERRORS.INTERNAL_ERROR,
          "Failed to parse JSON response",
          errorToObject(jsonResult.error),
        ),
      );
    }

    responseData = jsonResult.data;
  }

  if (!isJsonRpcResponse(responseData)) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INVALID_REQUEST,
        "Invalid JSON-RPC response format",
        responseData,
      ),
    );
  }

  if (responseData.id !== reqId) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INVALID_REQUEST,
        "Response ID does not match request ID",
        { requestId: reqId, responseId: responseData.id },
      ),
    );
  }

  if (
    !options?.skipDateParsing &&
    responseData.result &&
    typeof responseData.result === "object"
  ) {
    responseData.result = parseIsoTimestamps(
      responseData.result as JsonObject,
    ) as TResult;
  }

  return jsonRpcResponseToResult(responseData);
};

/**
 * Json Rcp Notification do expect Response therefore do not have ID
 */
export const jsonRpcNotification = async <TParams = unknown>(
  url: string,
  method: string,
  params?: TParams,
  options?: JsonRpcFetchOptions,
): Promise<JsonRpcResult<void>> => {
  // Create notification request (no ID)
  const request = createJsonRpcNotification(method, params);

  const controller = new AbortController();

  const fetchResult = await tryCatch(async () => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify(request),
      signal: options?.signal || controller.signal,
    });
  });

  if (!isOk(fetchResult)) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INTERNAL_ERROR,
        "Network error",
        errorToObject(fetchResult.error),
      ),
    );
  }

  const response = fetchResult.data;

  if (!response.ok) {
    return err(
      createJsonRpcError(
        JSONRPC_ERRORS.INTERNAL_ERROR,
        `HTTP ${response.status}: ${response.statusText}`,
        { status: response.status, statusText: response.statusText },
      ),
    );
  }

  // Notifications don't expect a response, so just return success
  return ok(undefined);
};

import { ok, err, type JsonObject } from "@binder/utils";
import type { McpContext, McpHandler } from "./types.ts";

export type Resource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
  content: (params: JsonObject, context: McpContext) => Promise<string>;
};

export type ResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

export type ListResourcesResult = {
  resources: Resource[];
};

export type ReadResourceResult = {
  contents: ResourceContent[];
};

export type ListResourcesRequest = {
  params?: unknown;
};

export type ReadResourceRequest = {
  params: {
    uri: string;
  };
};

export const resources: Resource[] = [];

export const handleListResources: McpHandler<
  ListResourcesRequest["params"],
  ListResourcesResult
> = async () => {
  return ok({
    resources,
  });
};

export const handleReadResource: McpHandler<
  ReadResourceRequest["params"],
  ReadResourceResult
> = async (params, context) => {
  const { uri } = params;

  const resource = resources.find((r) => r.uri === uri);

  if (resource) {
    const content = await resource.content(params, context);

    return ok({
      contents: [
        {
          uri,
          mimeType: resource.mimeType,
          text: content,
        },
      ],
    });
  }

  return err({
    code: 404,
    message: `Resource not found: ${uri}`,
    data: { uri },
  });
};

export const resourceHandlers: Record<string, McpHandler<any, any>> = {
  "resources/list": handleListResources,
  "resources/read": handleReadResource,
};

import { pathToFileURL } from "url";
import type { Hono } from "hono";
import { fail, isErr, ok, tryCatch, type ResultAsync } from "@binder/utils";
import type { KnowledgeGraph } from "@binder/repo";
import type { Logger } from "../log.ts";
import type { AppConfig } from "../config.ts";
import type { FileSystem } from "../lib/filesystem.ts";

export type ServerModuleContext = {
  kg: KnowledgeGraph;
  log: Logger;
  config: AppConfig;
  fs: FileSystem;
};

/**
 * HTTP server extension module. Default-export a factory that returns
 * a Hono app. Returned routes are mounted after binder's built-in `/api/*`
 * routes, so any collision is silently won by binder.
 */
export type ServerModule = (ctx: ServerModuleContext) => Hono | Promise<Hono>;

export const DEFAULT_SERVER_FILES = ["server.ts", "server.mjs", "server.js"];

const looksLikeHono = (v: unknown): v is Hono =>
  !!v &&
  typeof v === "object" &&
  typeof (v as { fetch?: unknown }).fetch === "function" &&
  Array.isArray((v as { routes?: unknown }).routes);

export const loadServerModule = async (
  ctx: ServerModuleContext,
  filePath: string,
): ResultAsync<Hono> => {
  const url = pathToFileURL(filePath).href;
  const modResult = await tryCatch(() => import(url));
  if (isErr(modResult)) {
    return fail(
      "http.server-module.load-failed",
      `Failed to load server module ${filePath}: ${modResult.error.message}`,
    );
  }
  const factory = (modResult.data as { default?: unknown }).default;
  if (typeof factory !== "function") {
    return fail(
      "http.server-module.invalid-export",
      `Server module ${filePath} must default-export a factory function`,
    );
  }
  const appResult = await tryCatch(async () => (factory as ServerModule)(ctx));
  if (isErr(appResult)) {
    return fail(
      "http.server-module.factory-threw",
      `Server module ${filePath} factory threw: ${appResult.error.message}`,
    );
  }
  if (!looksLikeHono(appResult.data)) {
    return fail(
      "http.server-module.invalid-return",
      `Server module ${filePath} factory must return a Hono app`,
    );
  }
  return ok(appResult.data);
};

/** Paths registered by binder's built-in API. Server module routes matching
 *  these are shadowed (binder wins) and we emit a warning. */
export const RESERVED_PATHS = [
  "/api/schema",
  "/api/config",
  "/api/config/:ref",
  "/api/records",
  "/api/records/:ref",
  "/api/transactions",
];

export const findShadowedRoutes = (
  app: Hono,
): { method: string; path: string }[] => {
  const reserved = new Set(RESERVED_PATHS);
  const out: { method: string; path: string }[] = [];
  for (const r of app.routes as { method: string; path: string }[]) {
    if (reserved.has(r.path)) out.push({ method: r.method, path: r.path });
  }
  return out;
};

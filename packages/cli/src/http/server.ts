import { join, relative } from "path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { isErr, ok, tryCatch, type ResultAsync } from "@binder/utils";
import { FiltersSchema, TransactionInputSchema } from "@binder/repo";
import type { KnowledgeGraph } from "@binder/repo";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { formatReferences } from "../document/reference.ts";
import type { Logger } from "../log.ts";
import type { AppConfig } from "../config.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import {
  DEFAULT_SERVER_FILES,
  findShadowedRoutes,
  loadServerModule,
} from "./serverModule.ts";

export type HttpServerConfig = {
  port: number;
  host: string;
  /**
   * undefined = use built-in public dir
   * null      = disable static serving entirely
   * string    = serve from this path (warn if missing)
   */
  staticDir: string | null | undefined;
};

export type HttpServerDeps = {
  kg: KnowledgeGraph;
  log: Logger;
  config: AppConfig;
  fs: FileSystem;
};

const BUILTIN_PUBLIC_DIR = new URL("./public", import.meta.url).pathname;

const RESERVED_QUERY_PARAMS = new Set(["limit", "after", "before", "orderBy"]);

const jsonError = (
  c: { json: (obj: unknown, status: ContentfulStatusCode) => Response },
  status: ContentfulStatusCode,
  message: string,
) => c.json({ error: message }, status);

export const createHttpApp = (
  serverConfig: Omit<HttpServerConfig, "staticDir" | "serverModule"> & {
    staticDir: string | null;
  },
  deps: HttpServerDeps,
  serverApp: Hono | null = null,
): Hono => {
  const { kg, log, config } = deps;
  const app = new Hono();

  app.get("/api/schema", async (c) => {
    const namespace = c.req.query("namespace") ?? "record";
    const result = await kg.getSchema(namespace as any);
    if (isErr(result)) return jsonError(c, 500, result.error.message);
    return c.json(result.data);
  });

  app.get("/api/config", async (c) => {
    const result = await kg.search({}, "config");
    if (isErr(result)) return jsonError(c, 500, result.error.message);
    return c.json(result.data);
  });

  app.get("/api/config/:ref", async (c) => {
    const ref = c.req.param("ref");
    const result = await kg.fetchEntity(ref as any, undefined, "config");
    if (isErr(result)) return jsonError(c, 404, result.error.message);
    return c.json(result.data);
  });

  app.get("/api/records", async (c) => {
    const query = c.req.query();

    const rawFilters: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query)) {
      if (!RESERVED_QUERY_PARAMS.has(k)) rawFilters[k] = v;
    }

    const filtersResult = FiltersSchema.safeParse(rawFilters);
    if (!filtersResult.success) {
      return jsonError(
        c,
        400,
        "Invalid filters: " + filtersResult.error.message,
      );
    }

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const orderBy = query.orderBy ? query.orderBy.split(",") : undefined;

    const result = await kg.search({
      filters: filtersResult.data,
      pagination: { limit, after: query.after, before: query.before },
      orderBy,
    });

    if (isErr(result)) return jsonError(c, 500, result.error.message);
    return c.json(result.data);
  });

  // Relation uids are formatted to keys so the UI can render them as links.
  app.get("/api/records/:ref", async (c) => {
    const ref = c.req.param("ref");
    const result = await kg.fetchEntity(ref as any);
    if (isErr(result)) return jsonError(c, 404, result.error.message);
    const schemaResult = await kg.getRecordSchema();
    if (isErr(schemaResult))
      return jsonError(c, 500, schemaResult.error.message);
    const formatted = await formatReferences(
      result.data as any,
      schemaResult.data,
      kg,
    );
    if (isErr(formatted)) return jsonError(c, 500, formatted.error.message);
    return c.json(formatted.data);
  });

  app.post("/api/transactions", async (c) => {
    const bodyResult = await tryCatch(() => c.req.json());
    if (isErr(bodyResult)) return jsonError(c, 400, "Invalid JSON body");

    const body = bodyResult.data;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonError(c, 400, "Request body must be a JSON object");
    }

    const parseResult = TransactionInputSchema.safeParse({
      author: config.author,
      ...body,
    });
    if (!parseResult.success) {
      return jsonError(
        c,
        400,
        "Invalid transaction: " + parseResult.error.message,
      );
    }

    log.debug("HTTP transaction", {
      records: parseResult.data.records?.length ?? 0,
      configs: parseResult.data.configs?.length ?? 0,
    });

    const result = await kg.update(parseResult.data);
    if (isErr(result)) return jsonError(c, 500, result.error.message);
    return c.json(result.data, 201);
  });

  // Mount user routes from server.ts after binder's /api/* so binder wins on
  // collisions, and before static so user API routes aren't shadowed by the
  // SPA index.html fallback.
  if (serverApp) app.route("/", serverApp);

  if (serverConfig.staticDir !== null) {
    // Block server module source files from being served as static assets,
    // even when the static dir contains them.
    for (const name of DEFAULT_SERVER_FILES) {
      app.get(`/${name}`, (c) => c.notFound());
    }

    const root = relative(process.cwd(), serverConfig.staticDir);
    app.use("/*", serveStatic({ root }));
    // Serve index.html for any unmatched route so client-side routing works
    app.use("/*", serveStatic({ root, path: "index.html" }));
  }

  return app;
};

export const startHttpServer = async (
  serverConfig: HttpServerConfig,
  deps: HttpServerDeps,
): ResultAsync<{ stop: () => Promise<void> }> => {
  const { log, fs, config } = deps;
  const { port, host, staticDir } = serverConfig;

  // Resolve effective static dir.
  //   null              → static serving disabled
  //   user dir          → serve user files; look here for server.ts
  //   .binder/web       → workspace convention default; look here for server.ts
  //   built-in browser  → fallback default; no server.ts lookup (binder-owned)
  let effectiveStaticDir: string | null;
  let userStaticDir: string | null = null;

  if (staticDir === null) {
    effectiveStaticDir = null;
  } else if (staticDir === undefined) {
    const conventionDir = join(config.paths.root, ".binder", "web");
    if (await fs.exists(conventionDir)) {
      effectiveStaticDir = conventionDir;
      userStaticDir = conventionDir;
    } else {
      effectiveStaticDir = BUILTIN_PUBLIC_DIR;
    }
  } else {
    const exists = await fs.exists(staticDir);
    if (!exists) {
      log.warn("Static directory does not exist, disabling static serving", {
        staticDir,
      });
      effectiveStaticDir = null;
    } else {
      effectiveStaticDir = staticDir;
      userStaticDir = staticDir;
    }
  }

  // Look for server.ts inside the user-provided static dir only. The built-in
  // record browser dir is binder-owned and never scanned.
  let serverApp: Hono | null = null;
  let serverModulePath: string | null = null;
  if (userStaticDir) {
    for (const name of DEFAULT_SERVER_FILES) {
      const candidate = join(userStaticDir, name);
      if (await fs.exists(candidate)) {
        serverModulePath = candidate;
        break;
      }
    }
  }

  if (serverModulePath) {
    const loaded = await loadServerModule(deps, serverModulePath);
    if (isErr(loaded)) return loaded;
    serverApp = loaded.data;
    const shadowed = findShadowedRoutes(serverApp);
    if (shadowed.length > 0) {
      log.warn(
        "Server module routes shadowed by binder built-ins (binder wins)",
        { routes: shadowed },
      );
    }
    log.info("Loaded server module", {
      path: serverModulePath,
      routes: serverApp.routes.length,
    });
  }

  const app = createHttpApp(
    { port, host, staticDir: effectiveStaticDir },
    deps,
    serverApp,
  );
  const server = serve({ fetch: app.fetch, port, hostname: host });

  log.info("HTTP server started", {
    port,
    host,
    staticDir: effectiveStaticDir ?? "disabled",
    serverModule: serverModulePath ?? "none",
  });

  const stop = (): Promise<void> =>
    new Promise((resolve) => server.close(() => resolve()));

  return ok({ stop });
};

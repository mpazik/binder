---
key: http-server
title: HTTP Server
tags: [ guide, http ]
---

# HTTP Server

## Overview

`binder http` starts a local HTTP server with three things:
- A **JSON API** over the knowledge graph — query records, read schema, apply transactions.
- A **static file server** for a UI — the built-in record browser by default, your own assets when you opt in.
- An **extension hook** (`server.ts`) for adding custom routes in the same process. Colocated with the static dir.

Use it when you want a browser UI on top of binder, when an integration speaks HTTP rather than MCP/CLI, or when a small piece of logic should live next to the data without spinning up a second process.

## Running the server

```bash
binder http              # http://127.0.0.1:4000
binder http --port 8080
binder http --host 0.0.0.0 --port 4000
```

Flags:
- `--port, -p` — port to bind (default `4000`)
- `--host` — host to bind (default `127.0.0.1`)
- `--static <dir>` — serve static files from `<dir>` instead of the built-in record browser
- `--no-static` — disable static serving entirely (API-only mode)

If no `--static` is given and `.binder/web/` exists, it is used automatically. Otherwise the built-in record browser is served.

Config (in `.binder/config.yaml`):

```yaml
http:
  port: 4000
  host: 127.0.0.1
  static: ./public
```

CLI flags override config values.

## JSON API

All endpoints return JSON. Errors are `{ "error": "<message>" }` with an appropriate HTTP status.

### `GET /api/schema`

Returns the merged record schema (built-in fields plus user-defined types and fields).

### `GET /api/config` / `GET /api/config/:ref`

List config records (types, fields, …) or fetch one by key, uid, or id.

### `GET /api/records`

Query records. Reserved query params: `limit`, `after`, `before`, `orderBy` (comma-separated). Any other query param is treated as a filter.

```bash
curl 'http://127.0.0.1:4000/api/records?type=Task&status=active&limit=20'
```

### `GET /api/records/:ref`

Fetch a record by key, uid, or id. Relation values are formatted as keys so the UI can render them as links.

### `POST /api/transactions`

Apply a transaction. Body matches the standard `TransactionInput` shape (`records` and/or `configs` arrays). The author is taken from workspace config.

```bash
curl -X POST http://127.0.0.1:4000/api/transactions \
  -H 'Content-Type: application/json' \
  -d '{"records":[{"type":"Task","key":"dark-mode","title":"Add dark mode","status":"active"}]}'
```

Returns the transaction result with changesets and HTTP `201`.

## Serving static files

Resolution order for the static directory:
1. `--static <dir>` flag (or `http.static` in config) — your assets.
2. `.binder/web/` if it exists — zero-config convention.
3. The built-in record browser — fallback default.

Unmatched routes fall back to `index.html` so client-side routing works in single-page apps.

`--no-static` turns static serving off entirely. Useful when binder is purely an API backend.

Static files are mounted last, after binder's `/api/*` routes and any `server.ts` routes, so they cannot shadow the API.

## Extending with `server.ts`

Drop a `server.ts` (or `server.mjs` / `server.js`) **inside your static directory** and `binder http` picks it up automatically:
- With `--static ./web`, `server.ts` lives at `./web/server.ts`.
- Without flags, `server.ts` lives at `.binder/web/server.ts`.
- The built-in record browser dir is binder-owned and never scanned, so when no static dir is configured there is no extension point.

`server.ts` is **not** served as a static asset. Requests for `/server.ts`, `/server.mjs`, and `/server.js` always return `404`, so source files in the static dir aren't exposed.

The module default-exports a factory that returns a [Hono](https://hono.dev) app:

```ts
import { Hono } from "hono";
import type { ServerModule } from "@binder.do/cli";

const mod: ServerModule = ({ kg }) => {
  const app = new Hono();

  app.get("/api/stats", async (c) => {
    const r = await kg.search({ filters: { type: "Task" } });
    return c.json({ tasks: "data" in r ? r.data.length : 0 });
  });

  app.post("/webhooks/issue", async (c) => {
    const body = await c.req.json();
    await kg.update({
      records: [{ type: "Task", title: body.title, status: "pending" }],
    });
    return c.json({ ok: true });
  });

  return app;
};

export default mod;
```

The factory receives `{ kg, log, config, fs }`:
- `kg` — the [`KnowledgeGraph`](../concepts/repository.md) (search, fetch, update, …)
- `log` — structured logger
- `config` — workspace config (paths, author, …)
- `fs` — filesystem abstraction

### Mount order and collisions

Routes are registered in this order: binder's `/api/*` → user routes from `server.ts` → static files. Hono matches first-registered, so **binder always wins on path collisions** with built-in API routes. A warning is logged at startup listing any shadowed paths.

User code is otherwise free to use any path, including unused subpaths under `/api/` (e.g. `/api/stats`, `/api/webhooks/...`).

### TypeScript

Node 22+ strips TypeScript types natively, so `.ts` files load without a build step. Plain `.js` and `.mjs` work too.

See the [Hono documentation](https://hono.dev) for routing, middleware, validation, and response helpers.

## Limits

- **No authentication.** Bind to `127.0.0.1` (the default). Do not expose the server to the network without a reverse proxy that handles auth.
- **No CORS by default.** If you need it, add Hono's `cors` middleware in `server.ts`.
- **No streaming responses yet.** Endpoints buffer full results.
- API surface may change before 1.0.

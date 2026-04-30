---
name: binder-app
description: Build a small HTTP app (dashboard, kanban board, admin panel, custom UI) on top of an existing Binder workspace. Use when asked to "create an app", "build a dashboard", "show records in a chart", "make a kanban/board", "build an admin panel", or "add a UI on top of binder".
---

# Binder App

Scaffold a small browser app served by `binder http`, on top of an existing Binder workspace. Default to plain HTML + vanilla JS, no build step, CDN libraries only when they save real work.

## When to use

User asks for a UI on top of their Binder data. Typical asks:

- "Create a dashboard of my transactions over time."
- "Build a kanban board of tasks grouped by status, drag and drop like Trello."
- "Make a small admin panel for my contacts."
- "Show me a chart of X grouped by Y."

If the user wants to query data without a UI, send them to the `binder-cli` skill instead.

## Workflow

### 1. Read the schema

Always start here. Do not guess type or field names.

```bash
binder schema                    # all types and fields
binder schema --types Task       # one type
```

Note for each type the user mentioned: required fields, allowed values for enum-like fields (`only: [...]`), and relation targets. Allowed values matter for kanban columns, chart axes, filters.

### 2. Plan, or ask

Before writing code, produce a short plan: what records get queried, how they get grouped or aggregated, what writes (if any) the UI performs, and which CDN libs (if any) you'll pull in.

Ask the user a clarifying question when any of these is unclear:

- Which type(s) to show, if the workspace has several plausible candidates.
- Which field drives grouping or the time axis (e.g. `createdAt` vs a domain field like `date`).
- Whether the UI is read-only or should write back (drag-and-drop status changes, edits, creates).
- Bucket granularity for time series (day/week/month).

Keep the plan to a few bullets. Do not ask more than two or three questions.

### 3. Decide: client-only or `server.ts`

Default to **client-only**. The built-in API is enough for most cases.

Add `.binder/web/server.ts` only when one of these is true:

- The aggregation is too heavy or awkward to do in the browser.
- You need an endpoint that talks to an external service (webhook, third-party API).
- You need a custom shape that combines multiple queries server-side.

For "dashboard of transactions over time" or "kanban with drag-and-drop", client-only is enough.

### 4. Scaffold

Place files under `.binder/web/`. `binder http` auto-serves this directory.

```text
.binder/web/
├── index.html
├── app.js
├── style.css
└── server.ts        # optional, only if needed
```

Source files (`server.ts`, `server.mjs`, `server.js`) at the top of the static dir are blocked from being served, so they won't leak.

### 5. Run and verify

```bash
binder http                      # http://127.0.0.1:4000
# Repo-specific: against the dev workspace in this repo only.
bun run dev http
```

Verify in this order:

1. Server starts, prints the URL.
2. `curl http://127.0.0.1:4000/api/schema` returns JSON.
3. Open the page in a browser. Records render.
4. If the UI writes, exercise one write end-to-end and confirm the change with `binder read <ref>` or by checking the Markdown file on disk.

## JSON API cheat sheet

All endpoints are same-origin (no CORS, no auth, localhost only).

```text
GET  /api/schema                          # types and fields
GET  /api/records?type=Task&status=active # filter; reserved: limit, after, before, orderBy
GET  /api/records/:ref                    # by key, uid, or id; relations rendered as keys
POST /api/transactions                    # apply a transaction, returns 201
```

`orderBy` is comma-separated. Prefix a field with `!` for descending (`orderBy=!createdAt`).

### Transaction body

```json
{
  "records": [
    { "type": "Task", "key": "dark-mode", "title": "Add dark mode", "status": "pending" },
    { "$ref": "tsk-abc123", "status": "complete" }
  ]
}
```

Use `type` to create, `$ref` (key or uid) to update. Relation values are keys or uids. The author is filled in from workspace config.

## Recipes

Both recipes are deliberately minimal. Extend with care: more code, more bugs.

### Recipe A: dashboard (records over time)

Aggregate client-side. No `server.ts`.

`.binder/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Dashboard</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 2rem; }
      canvas { max-width: 800px; }
    </style>
  </head>
  <body>
    <h1>Transactions over time</h1>
    <canvas id="chart"></canvas>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

`.binder/web/app.js` (replace `TYPE` and `DATE_FIELD` with the values you confirmed in step 1):

```js
const TYPE = "Transaction";
const DATE_FIELD = "date";

const res = await fetch(
  `/api/records?type=${TYPE}&limit=1000&orderBy=${DATE_FIELD}`
);
const { items } = await res.json();

const byMonth = new Map();
for (const r of items) {
  const d = new Date(r[DATE_FIELD]);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
}

const labels = [...byMonth.keys()].sort();
new Chart(document.getElementById("chart"), {
  type: "bar",
  data: { labels, datasets: [{ label: "Count", data: labels.map((k) => byMonth.get(k)) }] },
});
```

Replace `TYPE`, `DATE_FIELD`, and the aggregation (sum a numeric field, average, etc.) based on what the user actually asked for.

### Recipe B: kanban with drag and drop

Read allowed `status` values from `/api/schema`. Write back on drop with `POST /api/transactions`.

`.binder/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Board</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 1rem; }
      #board { display: flex; gap: 1rem; align-items: flex-start; }
      .col { flex: 1; background: #f4f4f4; border-radius: 6px; padding: .5rem; min-height: 200px; }
      .col h2 { font-size: 13px; margin: 0 0 .5rem; text-transform: uppercase; }
      .card { background: white; border: 1px solid #ddd; border-radius: 4px;
              padding: .5rem; margin-bottom: .5rem; cursor: grab; }
    </style>
  </head>
  <body>
    <h1>Tasks</h1>
    <div id="board"></div>
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@1/Sortable.min.js"></script>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

`.binder/web/app.js` (replace `TYPE` and `STATUS_FIELD` with the values you confirmed in step 1):

```js
const TYPE = "Task";
const STATUS_FIELD = "status";

// Schema shape: { fields: { <key>: { dataType, options: [{key,name}], ... } }, types: {...} }
// Enum-like fields have dataType "option" with an `options` array.
const schema = await fetch("/api/schema").then((r) => r.json());
const statuses = schema.fields[STATUS_FIELD].options.map((o) => o.key);

const { items } = await fetch(`/api/records?type=${TYPE}&limit=500`).then((r) => r.json());

const board = document.getElementById("board");
for (const status of statuses) {
  const col = document.createElement("div");
  col.className = "col";
  col.dataset.status = status;
  col.innerHTML = `<h2>${status}</h2>`;
  for (const r of items.filter((x) => x[STATUS_FIELD] === status)) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.key = r.key;
    card.textContent = r.title ?? r.key;
    col.appendChild(card);
  }
  board.appendChild(col);
  Sortable.create(col, {
    group: "board",
    onAdd: async (e) => {
      const key = e.item.dataset.key;
      const status = e.to.dataset.status;
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ $ref: key, [STATUS_FIELD]: status }] }),
      });
      if (!res.ok) console.error("transaction failed", await res.text());
    },
  });
}
```

Adjust `TYPE`, `STATUS_FIELD`, and what each card displays based on the schema.

## When you do need `server.ts`

Drop it at `.binder/web/server.ts`. Default-export a factory that returns a Hono app. Binder's `/api/*` routes always win on collision.

```ts
import { Hono } from "hono";
import type { ServerModule } from "@binder.do/cli";

const mod: ServerModule = ({ kg }) => {
  const app = new Hono();
  app.get("/api/stats/by-month", async (c) => {
    const r = await kg.search({ filters: { type: "Transaction" } });
    if ("error" in r) return c.json({ error: r.error.message }, 500);
    const out = {};
    for (const t of r.data.items) {
      const k = String(t.date).slice(0, 7);
      out[k] = (out[k] ?? 0) + 1;
    }
    return c.json(out);
  });
  return app;
};

export default mod;
```

Node 22+ runs `.ts` directly, no build step.

## Constraints

- Bound to `127.0.0.1` by default. Do not expose without a reverse proxy.
- No auth, no CORS. Same-origin only unless the user adds Hono's `cors` middleware.
- No streaming responses. Endpoints buffer.
- Source files (`server.ts`, `server.mjs`, `server.js`) at the static-dir root are not served.
- Unmatched routes fall back to `index.html` (SPA-friendly).

## Done checklist

- [ ] Schema was read before writing code.
- [ ] Plan was stated; clarifying questions asked when ambiguous.
- [ ] Files live under `.binder/web/`.
- [ ] Client-only unless an explicit reason justified `server.ts`.
- [ ] No build step, no bundler, no `package.json` for the app.
- [ ] CDN libs are pinned to a major version (e.g. `chart.js@4`).
- [ ] If the UI writes, one write was exercised end-to-end against the running server.

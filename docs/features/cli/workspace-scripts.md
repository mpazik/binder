---
key: workspace-scripts
title: Workspace Scripts
tags: [ cli ]
status: complete
description: Run workspace-local scripts from .binder/scripts as binder subcommands, with argument passthrough and workspace context.
sourceFiles:
  - packages/cli/src/commands/run.ts
  - packages/cli/src/lib/scripts.ts
  - packages/cli/src/index.ts
  - packages/repo/src/local/open.ts
relatesTo:
  - cli-interface
---

# Workspace Scripts

## Details

### Overview

Workspace scripts let a Binder workspace expose local automation as CLI commands. Put a script file in `.binder/scripts/`, then run it with `binder run <name>` or, when it does not collide with a built-in command, `binder <name>`.

Script names come from the filename stem. For example, `.binder/scripts/weekly-report.ts` is named `weekly-report`.

### Usage

```bash
binder run                    # list discovered scripts
binder run weekly-report      # run .binder/scripts/weekly-report.ts
binder weekly-report          # shorthand when no built-in command has that name
binder run weekly-report -- --since 2026-05-01
```

Arguments after the script name are passed through to the script. The script subprocess inherits stdin, stdout, stderr, and the parent environment.

### Script Directory

Binder discovers scripts directly under `.binder/scripts/`. Supported extensions are:
- `.ts` — run with `node --experimental-strip-types`
- `.js` and `.mjs` — run with `node`
- `.sh` — run directly when executable, otherwise with `sh`

Duplicate stems conflict. For example, `report.ts` and `report.sh` both define `report`; `binder run report` fails until one is removed or renamed.

### Built-In Command Conflicts

Built-in commands always win for bare invocation. If `.binder/scripts/search.ts` exists, `binder search` still runs the built-in search command.

Use `binder run search` to run a script whose name shadows a built-in command. `binder run` marks those entries as shadowed in the listing.

### Workspace Context

Scripts run with the workspace root as their current working directory. Binder also sets `BINDER_WORKSPACE` to that root, so scripts can locate the workspace even when they spawn child processes or import Binder as a library.

TypeScript and JavaScript scripts can open the current workspace via the `openWorkspace` library entry:

```ts
import { openWorkspace, isErr } from "@binder.do/cli/workspace";

const result = await openWorkspace({ clientId: "my-report-script" });
if (isErr(result)) throw result.error;

const { kg, config, close } = result.data;
// kg is the repo knowledge graph — use kg.update() / kg.search() etc.
// Transactions originated through this handle are stamped with
// source: "my-report-script" for provenance tracking.

try {
  const tasks = await kg.search({ filters: { type: "Task", status: "active" } });
  if (isErr(tasks)) throw tasks.error;
  console.log(tasks.data.items);
} finally {
  await close(); // idempotent — safe to call more than once
}
```

#### `openWorkspace(options?)`

Resolves the workspace from `BINDER_WORKSPACE`, then by walking up from `options.cwd` (or `process.cwd()`) to find `.binder/config.yaml`.

| Option     | Type      | Default         | Description                                                                                                                                                                                                                                                                                         |
| ---------- | --------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId` | `string`  | —               | Identifies the client (script, agent, service) opening the workspace, **kebab-case** (lowercase letters, digits, single hyphens). Stamped verbatim as `source` on originated transactions, and used as the log file stem (`<clientId>.log`). An invalid id fails the open with `invalid-client-id`. |
| `cwd`      | `string`  | `process.cwd()` | Directory to start workspace resolution from.                                                                                                                                                                                                                                                       |
| `silent`   | `boolean` | `true`          | Suppress interactive output.                                                                                                                                                                                                                                                                        |
| `logLevel` | `string`  | `"info"`        | Log verbosity (`debug`, `info`, `warn`, `error`).                                                                                                                                                                                                                                                   |

Returns a `Result<WorkspaceHandle>`, where the handle exposes:
- **`kg`** — the repo knowledge graph, opened with full `binder update` parity: writes run migrations and fire the journal, undo, and docs plugins, so committed transactions are journaled, remain undoable, and re-render their Markdown files just as a CLI write would.
- **`config`** — resolved workspace configuration (paths, author, etc.).
- **`close()`** — async, idempotent teardown.

When `clientId` is given, the workspace logs to `<workspace>/.binder/logs/<clientId>.log`; otherwise to a shared `library.log` (separate from the interactive `cli.log`).

Concurrency is handled by SQLite WAL mode with `busy_timeout`; there is no file lock.

#### Library resolution

The `@binder.do/cli/workspace` import resolves with no per-workspace setup — no `package.json`, no `npm install`. When you run a script via `binder run <name>` (or the bare `binder <name>` shorthand), the CLI first links itself into the workspace:

```
<workspace>/.binder/node_modules/@binder.do/cli  ->  <the running binder>
```

It rewrites this link on every run, so a script always imports the **exact binder version that launched it** — there is no separate workspace version to drift, even when several binder builds operate on the same workspace. The link lives under `.binder/` (generated, gitignored) and keeps the workspace and the CLI install cleanly separated.

This resolution only applies to scripts launched through `binder run`. The `./workspace` export selects source under Bun (dev) and the bundled `dist` under Node (production) automatically via package export conditions.

### Scope

Workspace scripts are plain subprocesses. They are not plugins and do not register hooks or commands in-process. They can be run outside Binder too, as long as their runtime dependencies and workspace context are available.

---
key: investigating-bugs
title: Investigating Bugs
tags: [ contributing ]
description: Tips for investigating and root-causing bugs in the binder codebase.
relatesTo:
  - testing-style
---

# Investigating Bugs

## Dev mode

All debugging should happen through `bun run dev`. This runs the CLI from source in dev mode, using `.binder-dev/` and `docs-dev/` instead of the production directories.

```
bun run dev search Task
bun run dev docs sync
bun run dev tx verify
```

The installed `binder` binary operates on `.binder/` and production docs. Don't use it for debugging unless you specifically need to inspect a production instance (see [Investigating a production instance](#investigating-a-production-instance)).

## Log files

Binder writes structured logs to `.binder-dev/logs/` (dev mode) or `.binder/logs/` (production). Each subsystem has its own log file:

| File         | Written by                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `cli.log`    | CLI commands (create, read, update, search, docs, etc.)                                                                         |
| `lsp.log`    | LSP server (editor integration)                                                                                                 |
| `mcp.log`    | MCP server                                                                                                                      |
| `binder.log` | Global/minimal runtime (init, pre-workspace commands). Always at `~/.local/state/binder/logs/binder.log`, not in the workspace. |

Logs rotate at 10 MB.

### Streaming logs to stderr

In dev mode (`bun run dev`), logs are already printed to stderr at debug level. No flags needed.

For the installed `binder` binary, use `--print-logs` to stream logs to stderr and `--log-level debug` for verbose output:

```
binder search Task --print-logs --log-level debug
```

## Querying state directly

### SQLite

In dev mode the database is at `.binder-dev/data/binder.db`. Querying it directly is often the fastest way to check data-layer state:

```
sqlite3 .binder-dev/data/binder.db "SELECT * FROM entities WHERE key = '...'"
sqlite3 .binder-dev/data/binder.db ".tables"
```

### Transaction log

The file `.binder-dev/data/transactions.jsonl` is a human-readable append-only log of every transaction. Each line is a JSON object. Useful for checking what actually happened:

```
tail -5 .binder-dev/data/transactions.jsonl | jq .
```

## Built-in diagnostic commands

- `bun run dev tx verify` -- checks that the database and transaction log are in sync and that hashes are valid. Start here after a crash or interrupted operation.
- `bun run dev tx repair` -- replays missing transactions to fix db/log drift. Use `--rehash` for hash algorithm migrations.
- `bun run dev tx log` -- shows recent transactions.
- `bun run dev locate <ref>` -- prints the file path for an entity.
- `bun run dev dev backup` -- snapshots the transaction log.
- `bun run dev dev reset` -- restores from backup, wipes the database, and rebuilds from the log.

## Document sync issues

Document sync is the bidirectional pipeline between Markdown/YAML files on disk and the knowledge graph in SQLite.

### Key commands

- `bun run dev docs sync [path]` -- reads modified files and applies changes to the database.
- `bun run dev docs render` -- writes all entities from the database back to files.
- `bun run dev docs lint [path]` -- validates files without changing anything. Good first step before syncing.

### Snapshot metadata

Binder tracks file hashes and modification times in the `cli_snapshot_metadata` table. This is how it detects which files changed since the last sync. When sync behaves unexpectedly, check whether the snapshot is stale or missing:

```
sqlite3 .binder-dev/data/binder.db "SELECT path, hash, mtime FROM cli_snapshot_metadata WHERE path LIKE '%your-file%'"
```

A file modified outside binder (e.g. by git checkout or a text editor without the LSP) will have a stale mtime/hash, causing sync to treat it as modified.

### The sync pipeline

1. `modifiedSnapshots()` compares files on disk against `cli_snapshot_metadata` to find changed, new, or removed files.
2. `extractModifiedFileChanges()` (CLI) or `extractFileChanges()` (LSP) parses each changed file and extracts entity data.
3. The diff module (`packages/cli/src/diff/`) matches extracted entities against existing database entities to produce changesets (creates, updates, deletes).
4. Changesets are applied as a transaction.

### Diff and matching

The `packages/cli/src/diff/` module handles matching entities between document state and database state. Bugs here often manifest as duplicate creates, missed updates, or unexpected deletes. The test files document the expected behavior:
- `entity-diff.test.ts` -- overall diff logic
- `entity-matcher.test.ts` -- how entities are paired between old and new state
- `similarity-scorer.test.ts` -- scoring function for fuzzy matching

### Common sync problems

- **Duplicate creates**: the matcher failed to pair a file entity with its database counterpart. Usually a UID or key mismatch.
- **No changes detected**: snapshot metadata already matches the file on disk. Check the `hash` column.
- **Wrong entity type**: the navigation tree mapped the file path to the wrong type. Check the navigation item's query/filters.
- **Stale snapshot**: a file was modified outside binder and the mtime in `cli_snapshot_metadata` is outdated.

## LSP issues

The LSP server runs over stdio via `bun run dev lsp`. It manages one or more workspaces, each with its own database connection and caches.

### Logs

LSP logs go to `.binder-dev/logs/lsp.log`. The LSP logs document opens, changes, saves, sync results, and cache invalidations. This is the first place to look.

### Save handler

On file save, the LSP runs the same extraction pipeline as `docs sync` but for a single file (`extractFileChanges`). The save handler:
1. Determines the namespace (record or config) from the file path.
2. Loads the navigation tree and schema.
3. Extracts changesets from the saved file content.
4. Applies the transaction to the database.

If sync works from the CLI (`bun run dev docs sync`) but not from the LSP, the issue is likely in how the LSP resolves the file path or namespace.

### Caches

The LSP maintains two caches per workspace:
- **Document cache**: parsed AST (YAML or Markdown) keyed by URI and version. Invalidated when a document changes.
- **Entity context cache**: fetched entity data for each document. Invalidated when a document changes or after a transaction commits.

Stale cache entries can cause diagnostics, completions, or hovers to show outdated data. Cache invalidation is logged at debug level in `lsp.log`.

### Testing without an editor

Many LSP features share logic with CLI commands. To isolate whether a bug is in the LSP layer or the underlying code:
- `bun run dev docs lint` -- compare diagnostics against what the editor shows.
- `bun run dev docs sync` -- test save-triggered sync outside the LSP.
- `bun run dev locate <ref>` -- verify entity-to-file resolution.

If the CLI produces the correct result but the LSP doesn't, the bug is in the LSP layer (caching, URI handling, workspace resolution). If both are wrong, the bug is in the shared code.

### Scripting LSP interactions

Use the LSP test script to send requests without an editor:

```
# Single command — hover at line 5, column 3 (1-based positions)
bun packages/cli/scripts/lsp-test.ts docs-dev/tasks/my-task.yaml hover 5:3

# Diagnostics (no position needed)
bun packages/cli/scripts/lsp-test.ts docs-dev/tasks/my-task.yaml diagnostics

# Completions at a specific position
bun packages/cli/scripts/lsp-test.ts docs-dev/tasks/my-task.yaml completion 2:8

# Go to definition
bun packages/cli/scripts/lsp-test.ts docs-dev/tasks/my-task.yaml definition 3:10

# Run against a different workspace
bun packages/cli/scripts/lsp-test.ts docs/tasks/my-task.yaml hover 5:3 --cwd=/path/to/workspace
```

All 8 actions are supported: `hover`, `completion`, `diagnostics`, `definition`, `code-actions`, `inlay-hints`, `semantic-tokens`, `save`.

For batch testing, pipe TSV to stdin (tab-separated: file, action, optional position):

```
printf 'docs-dev/tasks/my-task.yaml\thover\t5:3\ndocs-dev/tasks/my-task.yaml\tdiagnostics\n' \
  | bun packages/cli/scripts/lsp-test.ts
```

Batch mode spawns one LSP server for all requests, opens each file once, and outputs one JSON object per line (JSONL). This is useful for reproducing sequences of interactions.

The script can also be imported as a library in tests:

```ts
import { runLspTest } from "../scripts/lsp-test.ts";

const results = await runLspTest({
  cwd: "/path/to/workspace",
  commands: [
    { file: "docs/tasks/my-task.yaml", action: "hover", position: { line: 4, character: 2 } },
    { file: "docs/tasks/my-task.yaml", action: "diagnostics" },
  ],
});
```

Note: positions in the library API are 0-based (LSP convention), while the CLI uses 1-based positions.

LSP stderr is forwarded to your terminal for debug visibility. Combine with `lsp.log` tailing for full context.

By default the script runs from source in dev mode, so it expects `.binder-dev/` and `docs-dev/` paths. To test against a production workspace (`.binder/`), set `BINDER_CLI` to the built binary:

```
export BINDER_CLI="node packages/cli/dist/index.js"
bun packages/cli/scripts/lsp-test.ts tasks/my-task.md diagnostics --cwd=/path/to/workspace
```

## MCP issues

The MCP server runs over stdio via `bun run dev mcp`. It exposes three tools: `schema`, `search`, and `transact`.

### Logs

MCP logs go to `.binder-dev/logs/mcp.log`. Each JSON-RPC request and response is logged, along with any errors from tool execution.

### MCP inspector

Use the inspector for interactive testing without an MCP client:

```
bun run mcp:inspect
```

This launches the `@modelcontextprotocol/inspector` UI connected to the dev MCP server.

## Investigating a production instance

Sometimes you need to look at the production `.binder/` data without modifying it.

The safest option is to query the database directly with sqlite3 in read-only mode:

```
sqlite3 -readonly .binder/data/binder.db "SELECT * FROM entities WHERE type = '...'"
sqlite3 -readonly .binder/data/binder.db ".tables"
```

Or inspect the transaction log, which is plain JSONL:

```
tail -5 .binder/data/transactions.jsonl | jq .
```

**Be cautious with CLI commands against production.** Even read-only commands like `binder search` or `binder tx verify` open the database with `migrate: true`, which may apply pending schema migrations. This is usually harmless but could be surprising if a new version added migrations.

Avoid `docs sync`, `docs render`, `create`, `update`, `delete`, or `tx repair` against production unless you intend to make changes.

## Narrowing down

### Follow the error key

Errors use a `Result` type with structured error keys like `"hash-mismatch"`, `"workspace-not-found"`, `"config-parse-failed"`. These keys are unique and searchable:

```
rg 'hash-mismatch' packages/
```

This leads you straight to the code path that produced the error.

### Check inputs first

Bad data flowing into a function is more common than broken logic. The CLI validates inputs at the boundary (Zod schemas, entity ref normalization), but data from files or the database may not match expectations. Common mismatches:
- A UID where a key is expected (or vice versa)
- A nullable field treated as required
- A filter applied in the wrong order

## Common patterns

- **Missing error propagation**: a `Result` error not checked with `isErr`
- **Schema mismatch**: database schema out of sync with TypeScript types after a migration
- **Order dependence**: operations that assume a sequence but run in parallel or get reordered
- **Log/db drift**: transaction log and database diverge after a crash. `bun run dev tx verify` detects this

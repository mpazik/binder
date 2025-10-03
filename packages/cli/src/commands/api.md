# Binder CLI — Git-inspired knowledge-graph for markdown-based self-organizing documentation

## Todo
- path, insert as specific place, splice?
- adjust the spec
- config instead of filed/type
- workspace: login etc
- transaction

## Global conventions

* Command shape: `binder <group> <verb> [subject] [options]`
* **Ref** = any of `id | uid | key`
* Output: `--format=[json | yaml |pretty | quiet]`
* Scope: `-C <dir>` or `--repo <path>` (-C changes CWD, --repo keeps CWD, but operates on repo in a different place)
* Safety: `--dry-run`, `--yes/-y`, `--force`
* Paging/order: `--limit`, `--after <cursor>`, `--before <cursor>`, `--order-by "<field[, !desc]>"`
* Includes: 
  * inspired by [jq](link to be added)
  * **Leading dot optional:** `key` == `.key`
  * **Dot paths:** `title`, `author.key`, `project.title`
  * **Arrays:**
      * Map all items: `children.key` (sugar) == `children[].key`
      * Index (0-based): `children[0].key`
      * Slice (half-open): `children[0:3].key` → items `0,1,2`
  * **Quoting odd keys:** `'field with spaces'`, `.'field.with.dot'`
  * **Soft traversal:** missing fields don’t throw (see Output shape)
  * **Multiple selectors:** pass `-i/--include` multiple times, or one comma-separated string
    Here’s a **minimal, drop-in** doc—same style/level as your Includes.
* Patches:
  * **Set fields:** `title=Hello` or `--set title=Hello` (both valid)
  * **Set lists:** `tags='["kg","md"]'`
  * **Set from file:** `body@docs/intro.md` (reads file content → string field)
  * **Unset fields:** `--unset tags` (repeatable)
  * **JSON/YAML via stdin:**
    ```yaml
      title: "Graph notes",
      author: { "set": "person/jan" },
      tags: { "insert": ["kg","markdown"], "remove": ["legacy"] },
      links: { "insert": ["note/beta"] },
      body: { "insert": "docs/alpha.md" }
    ```

---

## Porcelain (everyday commands)

### 1) node — create/read/update/delete/list

* `binder node create <type> [...patches]`
* `binder node read <ref> [--includes <json> | --fields "<f1,f2>"]`
  Selective include semantics match Entity Query (identifiers must be requested when `includes` is present).
* `binder node update <ref> [...patches]`
  General field patching (strings, numbers, JSON, files).

    * Relation helpers (since relations are fields):

        * `--add <relField>:<ref>` (append to list relation)
        * `--rm  <relField>:<ref>` (remove from list relation)
        * `--set-rel <relField>=<ref>` (set single-valued relation)
    * Examples

      ```bash
      binder node update my-first-note body@docs/first-note.md
      binder node update my-first-note --add links:person/jan --add links:note/idea-42
      binder node update my-first-note --rm links:note/idea-42
      binder node update task-123 --set-rel project=proj/q3-refactor
      ```
* `binder node delete <ref> [--soft | --hard]`
* `binder node list [--type <type>] [--filter <json>] [--limit N] [...]`

### 2) type — define/inspect schema types (by key)

* `binder type create <type> [...patches]`
* `binder type read <type>`
* `binder type list`
* `binder type delete <type> [--force]`

### 3) field — define/modify fields on a type (by key)

* `binder field create <fieldKey> [...patches]`
* `binder field update <fieldKey> [...patches]`
* `binder field delete <fieldKey>`

> Note: relation fields point to other node types; the CLI handles add/rm/set through `node update` helpers above (no separate “edge” commands).

### 4) file — Markdown↔graph reconciliation & rendering

* `binder file refresh <path>` — Parse file, diff with graph, reconcile, update both if needed.
* `binder files refresh [--all | --glob "docs/**/*.md"]`
* `binder render <path> [--out <file>]` — Execute dynamic query blocks and write back or export HTML.
* `binder diff file <path> [--since <rev>]`
* `binder watch [--glob "docs/**/*.md"]` — Live refresh & render on change.

### 5) query & search

* `binder search '<dsl>'` — Quick search DSL.
  Examples:

  ```bash
  binder search 'type=Note createdAt=yesterday "graph indexes"'
  binder search 'type=Task status=in-progress assignee=@kai'
  ```
* `binder query [--in <json> | --stdin]` — Raw JSON Entity Query with filters, includes, order, pagination.

### 6) history & change management

* `binder log [--limit 50] [--since <date>] [--node <ref>] [--file <path>]`
* `binder status` — Dirty files, pending refresh, unapplied renders.
* `binder tag <txid> <labelKey>` — Mark important transactions.

### 7) transactions, rollback, revert
* `binder commit | abort [--id <txid>]` file of trasnaction
* `binder rollback create [--to <rev|timestamp>] [--scope node:<ref>|type:<key>|all]`
  Creates a **new** rollback transaction (non-destructive).
* `binder revert <tx-ref> [--force-until <tx-ref>]`
  Danger-zone removal of a transaction or a contiguous range.

### 8) import / export / snapshot
* `binder export graph [--format <json|ndjson>] [--out <path>] [--filter <json>]`
* `binder import graph [--in <path|stdin>] [--merge|--replace]`
* `binder snapshot create | list | delete`
* `binder restore <snapshotId | date>`

### 9) indexes & health

* `binder index rebuild [--types "Note,Task"] [--fields "name"] [--index='embeding,relations]`
* `binder validate [--fix]`
* `binder doctor` — Detect schema drift, orphaned refs, broken relations.


### 11) ingest — LLM-assisted intake/enrichment
* `binder ingest add <path|url> [--type <type>] [--parser <md|pdf|html>]`
* `binder ask "<question>" [--scope <json|query>] [--show-sources]` — RAG over graph/files.

### 12) workspace (optional Git-like affordances)
* `binder init [--bare]`
* `binder remote add <key> <url>` / `pull` / `push`
* `binder branch [--create <key>]` / `merge <branchKey>`
* `binder stash [push|pop]`
* `binder login`

---

## Plumbing (low-level)
* `binder rev-list [--node <ref>] [--after <cursor>]`
* `binder rev-parse <expr>` — Resolve refs (`id|uid|key`, ranges).
* `binder hash-file <path>`
* `binder ls-keys [--type <type>]` — Enumerate keys by selector.

---

## Examples (relations as fields)

```bash
# Create two nodes
binder node create type=Person key=jan firstName=Jan
binder node create type=Note   key=idea-42 title="Edge-less relations"

# Link them via a relation field `links` (list relation)
binder node update idea-42 --add links:jan
binder node read   idea-42 --includes '{"links": {"includes": {"key": true}}}'
```

> Note how `--includes` mirrors the query spec, and how `key` must be requested explicitly when `includes` is used.

---

## Quick DSL vs JSON query

```bash
# DSL
binder search 'type=Note createdAt=yesterday "binder blocks"'

# JSON Entity Query (same intent)
binder query --in '{
  "filters": { "type": "Note", "title": { "op": "contains", "value": "binder blocks" } },
  "orderBy": ["!createdAt"],
  "pagination": { "limit": 20 }
}'

# YAML Entity Query (same intent)
binder query --in '
  filters: { "type": "Note", "title": { "op": "contains", "value": "binder blocks" } },
  orderBy: ["!createdAt"],
  pagination: { "limit": 20 }
'
```

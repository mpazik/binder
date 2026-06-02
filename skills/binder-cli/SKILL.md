---
name: binder-cli
description: Binder CLI for knowledge graph operations — CRUD, search, schema inspection, transaction import, docs rendering. Use when asked to "query binder", "search records", "create a record", "check the schema", "import transactions", "undo changes", or work with a binder workspace.
---

# Binder CLI

Binder is a Markdown-native knowledge graph. The CLI is the primary interface for all operations.

Run `binder --help` or `binder <command> --help` for full usage details.

## Quick Reference

```bash
binder read <ref>                                   # Read a record
binder search type=Task status=active               # Search records
binder schema --types Task                           # Inspect schema
binder create <Type> field=value [field=value...]    # Create a record
binder update <ref> field=value [field=value...]     # Update fields
binder delete <ref>                                  # Delete a record
binder tx import -d file.yaml                        # Dry-run a transaction file
binder tx import file.yaml                           # Apply a transaction file
binder tx log --limit 5                              # Recent transactions
binder undo [N]                                      # Undo last N transactions
```

Global options: `-C <path>` cwd, `-q` quiet, `--format` output format, `-n` namespace.

## Reading

### read

```bash
binder read <ref> [--format yaml|json] [-f fields]
```

Ref: id (numeric), uid (e.g. `6VI6iLYBQUg`), or key (e.g. type/field keys `Task`, `status`, or a record key like `example-task`).

Use `-f/--fields` to include or traverse relations inline — same syntax as `search`.

### search

```bash
binder search type=Task status=active       # Filter by field values
binder search "some text"                   # Full-text search
binder search type=Task -f partOf(title)    # Include fields from related records
binder search type=Task -o '!priority'      # Order by (! = descending)
binder search type=Task --limit 10          # Limit results
```

Options:
- `--format` — `json`, `jsonl`, `yaml`, `csv`, `tsv`
- `-n, --namespace` — `record` (default) or `config`
- `-f, --fields` — include specific fields or traverse relations. `title,status` includes those fields. `partOf(title,status)` follows the `partOf` relation and includes `title` and `status` from the related record. Use `relatesTo[type=Task](title)` to filter relation targets by type before traversal.
- `-o, --orderBy` — sort (prefix `!` for descending)
- `--limit` — max results

### schema

```bash
binder schema                        # All types and fields
binder schema --types Task           # Specific type(s)
binder schema -n config              # Config namespace
```

## Writing

```bash
binder create <Type> field=value [field=value...]   # Create a record
binder update <ref> field=value [field=value...]     # Update fields
binder delete <ref>                                  # Delete a record
```

For 3+ changes or mixed namespace operations, use transaction files instead.

## Field Syntax

### Patch Operators

- `field=value` — set
- `field+=value` — append to array
- `field-=value` — remove from array
- `field:0+=value` — insert at position
- `field:last--` — remove last
- `'fields:title={required: true}'` — patch nested attributes

### Arrays

Delimiter depends on the field's text format (check `binder schema`):
- Comma-delimited (identifier, word, phrase, semver): `field=a,b,c`
- Newline-delimited (line, uri, filepath): `field=$'a\nb\nc'`
- Blank-line-delimited (paragraph, block): `field=$'first block\n\nsecond block'`
- Section/document: use transaction files (content contains headers and blank lines that don't escape cleanly in shell)

### Relations

Set a relation field to the target's uid or key:

```bash
binder create Task key=fix-auth title="Fix auth" taskType=fix partOf=mst-v1
binder update example-task requires+=write-tests             # add a relation (refs by key)
binder update example-task requires-=write-tests             # remove a relation
binder update example-task relatesTo=write-tests,6VI6iLYBQUg # set multiple, mixing key and uid
```

The target record must exist before you can reference it. Use `binder search` to find the target's key or uid first.

## Transaction Files

Write a transaction YAML file for bulk changes, or when a set of changes must apply atomically (all-or-nothing).

**Workflow**: write YAML → dry-run (`binder tx import -d file.yaml`) → show output to the user and get approval → apply (`binder tx import file.yaml`). Always dry-run first, never skip approval.

The file is a list of transaction entries. Each entry holds a `records` and/or `configs` array of changesets that apply together. A changeset is one of:

- **Create / upsert** — has `type`, optionally with a `key` (or `uid`). Creates the entity; if one with that key/uid already exists it updates instead. Re-running is idempotent.
- **Update** — no `type`; select the existing entity with `key:` or `uid:` and list only the changed fields.
- **Delete** — an identifier plus `$delete: true`.

If you hold an identifier but don't know whether it's a uid or a key, use `$ref:` and binder resolves it to either. Otherwise prefer `key:` (readable) or `uid:`.

Optional per-entry metadata sits alongside `records`/`configs`:

- `author` — who made the change; defaults to the workspace config author.
- `message` — short summary, like a commit message.
- `tags` — labels for categorisation and filtering (e.g. `cleanup`, `import`).
- `source` — uid/key of the record that triggered the change.
- `channel` — origin: `cli`, `lsp`, `mcp`, `agent`, or `engine`.

Omit all of these by default. Add a `message` or `tags` only when the user asks for one; `author`, `source`, and `channel` are set by the system.

```yaml
- records:
    - type: Task                  # create
      key: implement-auth
      title: Implement auth
      status: pending
      partOf: mst-v1
      requires: [write-tests]      # relation by key (readable)
    - uid: 6VI6iLYBQUg            # update an entity you only have the uid for
      status: done
      tags: [[insert, "urgent"]]
    - type: Task                  # upsert: create if `fix-auth` is new, else update
      key: fix-auth
      status: done
  configs:
    - key: nav-backlog            # update config by key
      where:
        type: Task
        status: pending
```

List field mutations: `[insert, value]`, `[insert, value, position]`, `[remove, value]`, `[patch, ref, {attrs}]`.

## History

```bash
binder tx log                        # Recent transactions
binder tx log --limit 5              # Last N
binder tx read <ref>                 # Read a transaction
binder undo [N]                      # Undo last N transactions
binder redo [N]                      # Redo last N undone
```

## Error Handling

- **Validation errors**: binder rejects missing required fields, invalid option values, and type mismatches. Read the error message, fix the field, retry.
- **Duplicate keys**: keys must be unique within a type. Search first if unsure: `binder search type=Task key=<key>`
- **Missing relation targets**: the target record must exist before you can reference it. Create targets first, or use a transaction file to create everything in one batch.

## Other Commands

Binder renders files and keeps Markdown and the knowledge graph in sync automatically (the LSP handles it). Run render/sync by hand only for recovery or in non-LSP environments:

```bash
binder docs render                   # Re-render files from the graph
binder docs sync                     # Re-sync the graph from Markdown
binder docs lint                     # Validate YAML and Markdown files
binder locate <ref>                  # Print file path and line number
binder init                          # Initialize new workspace
```

## Tips

- Run `binder schema` if it is not in your context
- Pick the right format for the job:
  - `--format tsv` for scannable search results
  - `--format yaml` for single records and nested data
  - `--format json | jq` for complex data processing
- Config entities use keys for references; record entities use UIDs

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

Ref: id (numeric), uid (e.g. `tsk-abc123`), or key (e.g. `Task`, `status`).

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
binder update tsk-abc123 requires+=tsk-def456       # Add a relation
binder update tsk-abc123 requires-=tsk-def456        # Remove a relation
binder update tsk-abc123 relatesTo=tsk-x,tsk-y       # Set multiple relations
```

The target record must exist before you can reference it. Use `binder search` to find the target's uid first.

## Transaction Files

For bulk or multi-step changes, write a transaction YAML file.

**Workflow**: write YAML → dry-run (`binder tx import -d file.yaml`) → show output to user and ask for approval → apply (`binder tx import file.yaml`). Always dry-run first, never skip approval.

Each entry has `author` and `records`/`configs` arrays. Use `type` to create, `$ref` (uid or key) to update:

```yaml
- author: agent
  records:
    - type: Task
      title: Implement auth
      status: pending
      partOf: mst-v1
      requires:
        - tsk-def456
    - $ref: tsk-abc123
      status: done
      tags:
        - - insert
          - urgent
  configs:
    - $ref: nav-backlog
      where:
        type: Task
        status: pending
```

List field mutations in transaction files: `["insert", value]`, `["insert", value, position]`, `["remove", value]`, `["patch", ref, {attrs}]`.

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

```bash
binder docs render                   # Render navigation to files
binder docs sync                     # Sync docs with knowledge graph
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

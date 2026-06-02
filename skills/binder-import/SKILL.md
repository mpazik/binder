---
name: binder-import
description: Import external data into a Binder workspace. Handles CSV, JSON, YAML, Markdown files, and directories of Markdown. Use when asked to "import data", "load records from a file", "ingest documents", "migrate data into binder", or bulk-create records from an external source.
---

# Binder Import

Import external data into a Binder knowledge graph by mapping source structure onto the existing schema, then generating transaction files.

## Supported Sources

- **Tabular**: CSV, TSV (rows become records, headers become field candidates)
- **Structured**: JSON array, YAML list (objects become records, keys become field candidates)
- **Single Markdown**: one file with repeating structure (tables, heading-delimited sections, lists)
- **Markdown directory**: folder of `.md` files where each file becomes one or more records (frontmatter fields + body content)

## Process Overview

1. **Sample** the source to understand structure
2. **Inspect** the target schema
3. **Analyze gaps** between source data and schema
4. **Propose mapping** and present to user
5. **Check for duplicates** against existing records
6. **Generate transactions** in batches
7. **Dry-run and apply** each batch

## Step 1: Sample the Source

Do not read the entire source upfront. Sample enough to understand structure and value patterns.

**Tabular files (CSV, JSON, YAML)**:
- Small (< 200 rows): read the whole file
- Large (200+ rows): read the first 50 rows. Note total row count. Ask the user if the structure is uniform throughout

**Single Markdown file**:
- Small (< 300 lines): read the whole file
- Large (300+ lines): read the first 200 lines. Ask the user if the pattern continues or if there are structurally different sections later

**Markdown directory**:
- List all files: `find <dir> -name '*.md' | head -100`
- Count total: `find <dir> -name '*.md' | wc -l`
- Read 3-5 files chosen for variety (different sizes, different subdirectories, first and last alphabetically)
- Note if files have frontmatter, consistent heading structure, or freeform content

Report what you found: number of items, identified columns/fields, sample values, any inconsistencies.

## Step 2: Inspect Target Schema

```bash
binder schema
binder schema -n config
```

Identify which types and fields already exist. Pay attention to:
- Field data types and constraints
- Required fields and defaults
- Relation fields and their targets
- Option fields and their allowed values

## Step 3: Schema Gap Analysis

Compare source fields against target schema. Classify each source field:

- **Direct match**: source field maps cleanly to an existing Binder field (same meaning, compatible data type)
- **Transformable match**: source field maps to an existing field but needs conversion (date format, enum normalization, splitting a combined value)
- **Missing field**: source has data with no corresponding Binder field
- **Missing type**: source describes an entity type that doesn't exist in the schema
- **Constraint conflict**: source values don't fit existing constraints (e.g. option values not in the allowed set, relation targets outside `only` list)

If there are missing fields, types, or constraint conflicts:
- List the gaps clearly
- Propose schema amendments (new fields, new types, constraint changes)
- Refer the user to the `binder-modeling` skill to apply schema changes
- **Pause the import** until the schema is updated. Do not proceed with partial mappings

## Step 4: Propose Mapping

Present a mapping table to the user:

```
Source Field     -> Binder Field     Type          Notes
──────────────────────────────────────────────────────────
name             -> title            string        direct
priority_level   -> priority         option        normalize: "P1"→"high", "P2"→"medium", "P3"→"low"
assigned_to      -> assignee         relation      lookup User by name, create if missing
description      -> description      richtext      direct
due              -> dueDate          date          parse from "MM/DD/YYYY" to ISO
category         -> (skip)           -             user confirmed: not needed
```

Include:
- Target Binder type (e.g. "will create Task records")
- Any fields that will be skipped and why
- Any transformations needed
- How relations will be resolved (lookup by name? create target records?)

**Wait for user confirmation before proceeding.**

## Step 5: Deduplication

Before generating transactions, check if the target workspace already has records that overlap with the import.

**Prefer upsert when the natural key maps to the binder `key`.** If each source record has a stable identifier you can use as the record `key`, emit an **upsert** (`type` + `key`) and let binder decide create vs update. This skips the per-record search entirely and makes re-imports idempotent. Fall back to the search-based flow below only for fuzzy matching or when the natural key is not the binder `key`.

### Identify Natural Keys

Determine which source field acts as a natural key, the field most likely to uniquely identify a record. Common candidates:
- `title` or `name`
- An external ID field (e.g. `githubIssue`, `jiraKey`)
- A combination of fields (e.g. type + date for journal entries)

Ask the user which field(s) to use for matching if it's ambiguous.

### Search for Existing Records

For each natural key value in the import batch:
```bash
binder search type=<TargetType> <keyField>="<value>" --format tsv
```

Or for bulk checking:
```bash
binder search type=<TargetType> --format jsonl | jq -r '.<keyField>'
```

### Handle Matches

- **Stable natural key**: emit an upsert (`type` + `key`) and let binder create-or-update. No search needed
- **Exact match found** (key not usable): generate a `uid: <uid>` update instead of a create. Only include fields that differ from the existing record
- **Fuzzy match** (similar but not identical): list the near-matches and ask the user whether to update, skip, or create new
- **No match**: generate a create

Report deduplication results: "X new records, Y updates to existing, Z skipped duplicates."

## Step 6: Batching Strategy

### Chunk Size

- **Default**: 50 records per transaction
- **With relations**: 30 records per transaction (relation resolution adds complexity to dry-run output)
- **Schema changes**: always a separate transaction, applied first

### Ordering

1. **Schema transactions first**: new fields, type changes (if any, via binder-modeling)
2. **Dependency order**: if records reference each other (e.g. parent-child), create parents before children
3. **By type**: group records of the same type together when importing multiple types

### For Markdown Directories

Natural batching options:
- **By subdirectory**: each subdirectory becomes one batch
- **By file count**: chunk into groups of 30-50 files
- **By type**: if different files map to different types, batch by type

Process one batch fully (generate, dry-run, apply) before starting the next. This lets the user catch problems early without wasting time generating all batches upfront.

### Resumability

Keep a simple tracking list (e.g. a text file or just telling the user) of which files/rows have been imported. If the process is interrupted, resume from the last completed batch.

## Step 7: Generate, Dry-Run, Apply

For each batch:

### Generate Transaction File

Write a YAML transaction file following Binder's format:

```yaml
- author: import
  records:
    - type: Task
      title: "Implement auth"
      status: pending
      priority: high
    - type: Task
      title: "Write tests"
      status: pending
      priority: medium
```

For upserts (create-or-update by stable key):

```yaml
- author: import
  records:
    - type: Task
      key: gh-1234        # stable natural key → created or updated
      title: "Implement auth"
      status: done
```

For updates to existing records by uid (when no usable key):

```yaml
- author: import
  records:
    - uid: 2Wh6GJpu6k0
      status: done
      completedAt: "2025-01-15"
```

Save to a descriptive filename: `import-<source>-batch-<N>.yaml`

### Dry-Run

```bash
binder tx import -d import-<source>-batch-<N>.yaml
```

Show the dry-run output to the user. Highlight:
- Number of creates vs updates
- Any validation errors
- Any warnings

### Apply

Only after user approval:

```bash
binder tx import import-<source>-batch-<N>.yaml
```

Report results and proceed to next batch.

## Tips

- Start with a small batch (10 records) as a trial run before importing everything
- For relation fields, make sure target records exist before importing records that reference them
- Use `binder search type=<Type> --format tsv` to quickly verify imported records
- If an import goes wrong, use `binder undo` to roll back the transaction
- Keep the generated YAML files around until the import is verified. They document exactly what was imported

## References

- [Mapping patterns for common formats](references/mapping-patterns.md)
- For schema changes: use the `binder-modeling` skill
- For CLI details: use the `binder-cli` skill

# binder-import: To Do

## Unhandled cases

- **Nested JSON/YAML**: deeply nested structures (3+ levels) where the mapping to flat records is ambiguous. Need a strategy for when to flatten vs create separate linked entities
- **Multi-type Markdown files**: a single file that contains multiple entity types (e.g. a meeting note with embedded action items, decisions, and attendees). Need rules for splitting vs keeping as one record
- **Incremental re-import**: re-running an import after the source file has been updated. Detecting what changed since last import, not just deduplicating
- **Relation resolution across batches**: batch 2 references a record created in batch 1 but we don't yet have its UID. Need a strategy for forward references or a two-pass approach
- **Images and attachments**: Markdown files referencing local images or linked files. What happens to those?
- **Non-UTF8 encodings**: source files in legacy encodings (Latin-1, Shift-JIS, etc.)
- **Very large directories** (1000+ files): sampling 3-5 files might miss structural outliers. Need a better sampling heuristic
- **Conflicting records in same batch**: two source rows that would create duplicate records within the same import (not just against existing data)
- **Partial failures**: a batch dry-run succeeds but apply fails mid-way. Recovery strategy beyond "use binder undo"

## Improvements

- **Validation report**: after import, run a summary query to verify record counts and spot-check field values
- **Mapping file persistence**: save the mapping as a reusable YAML/JSON file so repeat imports from the same source format don't require re-mapping
- **Dry-run diff summary**: instead of showing raw dry-run output, summarize it (N creates, M updates, field coverage stats)
- **Interactive field mapping**: for ambiguous cases, walk the user through one field at a time instead of presenting the whole table at once
- **Source format detection**: auto-detect file format from extension and content rather than requiring the user to specify
- **Relation creation cascades**: when a relation target doesn't exist (e.g. assignee "Alice" with no User record), offer to create target records as part of the import rather than always requiring a separate step
- **Tag/label normalization**: source data often has inconsistent tags ("In Progress", "in-progress", "IN_PROGRESS"). Add a normalization step
- **Progress reporting for large imports**: show batch N/M progress, estimated time, records processed so far
- **Rollback plan**: before starting a multi-batch import, state how many `binder undo` calls would be needed to fully revert, or generate a single undo script

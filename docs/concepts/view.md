---
key: view
name: View
tags: [ rendering ]
status: active
description: Defines how entities are rendered as markdown files and how content is extracted back into structured data. Views use field slot interpolation with pipe-delimited props for filtering and sub-view references. Rendered files support bidirectional sync so editing a file updates the underlying entity.
alternativeNames: [ template, rendered document, snapshot ]
sourceFiles:
  - packages/cli/src/document/view.ts
  - packages/cli/src/document/view-entity.ts
  - packages/cli/src/document/extraction.ts
relatesTo:
  - entity
  - type
  - navigation
  - query
  - feat-preamble-include-filters
  - fix-preamble-body-slot-conflict
  - view-system
  - doc-navigation
  - bidirectional-sync
  - nested-view-rendering
  - preamble
  - language-server
  - save-triggered-sync
  - prob-snapshot-versioning
  - prob-document-schema-model
  - fix-markdown-escaping
  - refactor-rename-template-to-view
  - fix-empty-richtext-render
---

# View

## Details

### Overview

A view defines how entity data becomes a readable file. Views use a field slot syntax — `{fieldName}` — to place entity values into a markdown structure. The rendered output is called a **snapshot**: an ephemeral file regenerated whenever the underlying entity changes.

The key insight is **bidirectional conversion**: snapshots aren't read-only exports. When a user edits a rendered markdown file, the system extracts field values back from the document structure and generates a transaction to update the source entity. This makes files the primary editing interface while entities remain the source of truth.

### Field Slots

Field slots are placeholders in views that get replaced with actual field values.

**Basic syntax**:
- **Standard**: `{fieldName}`
- **Nested**: `{parent.title}`, `{project.status}`
- **With view**: `{tasks|view:task-card}`
- **Escaping**: `{{literal}}` renders as `{literal}`

**Expression syntax**: a path with optional pipe-delimited props:

```
{path|prop1|prop2:value|prop3:"quoted value"}
```

- **Path**: Dot-separated field key, e.g. `fieldName` or `parent.child`
- **Flag**: `{field|highlight}` → `{ highlight: true }`
- **Single value**: `{field|view:task-card}` → `{ view: "task-card" }`
- **Multiple args**: `{field|prop:arg1,arg2}` → `{ prop: ["arg1", "arg2"] }`
- **Quoted value**: `{field|where:"a=1,b=2"}` → `{ where: "a=1,b=2" }`

**Value coercion**: `true`/`false` → boolean, digits → number, quoted strings → unquoted string, everything else → string.

**Nested field access**: Access fields from related entities using dot notation (`{parent.title}`, `{children.summary}`). Maximum depth is 2 levels. Cannot use `{multiRelation.multiValueField}`.

**Code blocks**: Field slots are not processed inside fenced or inline code blocks, avoiding conflicts with languages that use `{...}` syntax.

### Slot Positions

The system automatically detects where a field slot appears in the document, which determines how content is rendered and extracted:
- **Inline**: Slot is part of a sentence or shares a line with other content. Replaces only the slot text. Example: `Author: {author.name}`
- **Block**: Slot is the only content in a paragraph. The entire paragraph is replaced by the rendered content, allowing views to control their own formatting.
- **Section**: Slot is a paragraph immediately preceding a header or at end of document. Used for lists of items that need their own subsections.
- **Document**: Slot is the only content in the entire document body. View has full control over structure.

### View Formats

Views come in different granularities matching text formats, composable within each other:
- **document**: full page view with headings and sections
- **section**: reusable section within a document
- **block**: paragraph-level content block
- **line**: single line, used for list items

**Compatibility rule**: Content of a smaller format can be used in a larger slot position. A line view can be used anywhere; a section view cannot be used in an inline position.

### Relation Fields and Filtering

When rendering related items, specify which view to use with `{tasks|view:task-card}`. If no view is specified, the system picks a default based on the slot position.

The `where:` prop filters multi-value relation fields before rendering:

```markdown
### To do
{milestoneTasks|where:status=pending|view:task-item}

### In progress
{milestoneTasks|where:status=active|view:task-item}

### Completed
{milestoneTasks|where:status=complete|view:task-item}
```

**Rendering**: Entities are filtered by the predicate before rendering. When no entities match, the slot produces no output.

**Extraction**: Entities under a `where:`-filtered section automatically inherit the filter's field values so a task listed under "In progress" gets `status: active`. When the same relation field appears in multiple `where:` sections, extracted entities are concatenated.

**Creating new relation children during sync**: When a new item appears in a relation field section, the sync engine must determine its type to create it. Type is resolved in this order:
1. An explicit `type` value in the rendered child content (e.g. a `{type}` slot rendered in the sub-view)
2. The field's global `range`, if it is constrained to exactly one type
3. The parent entity's type-level `only` constraint for that field, if it is constrained to exactly one type

If none of these uniquely identifies a type, sync fails with an error. To avoid this, either ensure the sub-view renders a `{type}` slot, constrain the field to a single type via `range`, or add an `{only: SingleType}` constraint on the field in the parent entity's type definition.

### Preamble (Frontmatter)

Views can declare a `preamble`: a list of fields rendered as YAML frontmatter at the top of the file:

```yaml
key: milestone-view
type: View
preamble: [key, status, dueDate, relatedFeatures]
viewContent: |
  # {title}
  {description}
```

Renders as:

```markdown
---
key: alpha-release
status: active
dueDate: 2025-03-15
relatedFeatures: [feat-1, feat-2]
---
# Alpha Release
First public release with core features.
```

Null/undefined values are omitted. Front matter fields take precedence over body fields with the same key during extraction.

**Filtered relation entries**: Relation fields in the preamble can carry a `filters` query to restrict which references appear. Use the obj-tuple form — a single-key mapping where the key is the field name and the value is the filter query:

```yaml
preamble:
  - status
  - tasks:
      filters:
        status: active
```

Only references matching the filters are included in the rendered frontmatter. Preamble entries always render as reference keys (not expanded objects), so any `includes` nested inside the query is ignored — only `filters` takes effect. During extraction, frontmatter values for a filtered preamble field are merged with the full relation: items present in the file are kept, items absent are removed, but only within the filtered subset.

### Snapshots and Bidirectional Sync

Rendered files are **snapshots**: tracked by the system with version metadata. The synchronisation cycle:
1. **Render**: Navigation triggers a query, resolves file paths, renders views, saves snapshots
2. **Detect changes**: System monitors snapshot files for external edits
3. **Extract**: Modified files are parsed to extract field values from the document structure
4. **Diff**: Extracted values are compared against current entity state
5. **Update**: Differences generate a transaction that updates the source entities

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

The system automatically detects where a field slot appears in the document. The detected position controls how content is rendered and extracted, and which field formats are accepted.

- **Inline** (`phrase`, `line`): Slot shares a line with other content. Replaces only the slot text. Example: `Author: {author.name}`.
- **Block**: Slot occupies a paragraph surrounded by other paragraphs.
- **Section**: Slot sits inside heading scope — a heading precedes it or follows it. Bounded by the next heading at the same depth, or end-of-doc.
- **Part**: Slot is bounded by a thematic break (`---`) on at least one side. Used to embed a self-contained region inside a larger template, overriding any surrounding heading scope.
- **Document**: Slot is the only content block in the file (frontmatter aside).

Position is derived from the surrounding markdown structure at render time, not declared on the field or view.

### Format / Slot Compatibility

A field's `richtextFormat` and `allowMultiple` together determine which positions can render it. The constraint is that a multi-value field's item delimiter must not collide with the slot's bounding construct, otherwise the parser cannot tell where the field ends.

| Field format / multiplicity | `block` | `section` | `part` | `document` |
|---|---|---|---|---|
| `block` (single)    | ✓ | ✓ | ✓ | ✓ |
| `block` (multi)     | ✗ | ✓ | ✓ | ✓ |
| `section` (single)  | ✗ | ✓ | ✓ | ✓ |
| `section` (multi)   | ✗ | ✓ | ✓ | ✓ |
| `document` (single) | ✗ | ✗ | ✓ | ✓ |
| `document` (multi)  | ✗ | ✗ | ✗ | ✓ |

Multi `block` and multi `document` bump the minimum slot because their item delimiters (blank line, `---`) coincide with the bounding construct of the same-named slot. Multi `section` does not bump the minimum: section items are delimited by headings at `sectionDepth + 1`, which nest cleanly inside any heading-bounded slot.

### View Formats

Views come in different granularities matching text formats, composable within each other:
- **document**: full page view with headings and sections
- **section**: reusable section within a document
- **block**: paragraph-level content block
- **line**: single line, used for list items

A view's format determines which slot positions can use it; see the format/slot compatibility table above.

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

### Snapshots and Bidirectional Sync

Rendered files are **snapshots**: tracked by the system with version metadata. The synchronisation cycle:
1. **Render**: Navigation triggers a query, resolves file paths, renders views, saves snapshots
2. **Detect changes**: System monitors snapshot files for external edits
3. **Extract**: Modified files are parsed to extract field values from the document structure
4. **Diff**: Extracted values are compared against current entity state
5. **Update**: Differences generate a transaction that updates the source entities

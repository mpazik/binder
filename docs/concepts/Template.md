---
status: active
description: A template that defines how entities are rendered as markdown files and how content is extracted back into structured data. Templates use field slot interpolation with pipe-delimited props for filtering and sub-template references. Rendered files (snapshots) support bidirectional sync — editing a snapshot updates the underlying entity.
alternativeNames: [ view, rendered document, snapshot ]
tags: [ rendering ]
sourceFiles:
  - packages/cli/src/document/template.ts
  - packages/cli/src/document/template-entity.ts
  - packages/cli/src/document/extraction.ts
  - packages/cli/src/document/synchronizer.ts
relatesTo: [ 1jgIHtJoM1M, 2J9ouH8xZek, 9yo_LyGb28Q, 2Wz5hDRrdzc ]
---

# Template

### Overview

A template defines how entity data becomes a readable file. Templates use a field slot syntax — `{fieldName}` — to place entity values into a markdown structure. The rendered output is called a **snapshot** — an ephemeral file regenerated whenever the underlying entity changes.

The key insight is **bidirectional conversion**: snapshots aren't read-only exports. When a user edits a rendered markdown file, the system extracts field values back from the document structure and generates a transaction to update the source entity. This makes files the primary editing interface while entities remain the source of truth.

### Field Slots

Field slots are placeholders in templates that get replaced with actual field values.

**Basic syntax**:
- **Standard**: `{fieldName}`
- **Nested**: `{parent.title}`, `{project.status}`
- **With template**: `{tasks|template:task-card}`
- **Escaping**: `{{literal}}` renders as `{literal}`

**Expression syntax** — a path with optional pipe-delimited props:

```
{path|prop1|prop2:value|prop3:"quoted value"}
```

- **Path**: Dot-separated field key, e.g. `fieldName` or `parent.child`
- **Flag**: `{field|highlight}` → `{ highlight: true }`
- **Single value**: `{field|template:task-card}` → `{ template: "task-card" }`
- **Multiple args**: `{field|prop:arg1,arg2}` → `{ prop: ["arg1", "arg2"] }`
- **Quoted value**: `{field|where:"a=1,b=2"}` → `{ where: "a=1,b=2" }`

**Value coercion**: `true`/`false` → boolean, digits → number, quoted strings → unquoted string, everything else → string.

**Nested field access**: Access fields from related entities using dot notation (`{parent.title}`, `{children.summary}`). Maximum depth is 2 levels. Cannot use `{multiRelation.multiValueField}`.

**Code blocks**: Field slots are not processed inside fenced or inline code blocks, avoiding conflicts with languages that use `{...}` syntax.

### Slot Positions

The system automatically detects where a field slot appears in the document, which determines how content is rendered and extracted:
- **Inline** — Slot is part of a sentence or shares a line with other content. Replaces only the slot text. Example: `Author: {author.name}`
- **Block** — Slot is the only content in a paragraph. The entire paragraph is replaced by the rendered content, allowing templates to control their own formatting.
- **Section** — Slot is a paragraph immediately preceding a header (or at end of document). Used for lists of items that need their own subsections.
- **Document** — Slot is the only content in the entire document body. Template has full control over structure.

### Template Formats

Templates come in different granularities matching text formats, composable within each other:
- **document** — full page template with headings and sections
- **section** — reusable section within a document
- **block** — paragraph-level content block
- **line** — single line, used for list items

**Compatibility rule**: Content of a smaller format can be used in a larger slot position. A line template can be used anywhere; a section template cannot be used in an inline position.

### Relation Fields and Filtering

When rendering related items, specify which template to use with `{tasks|template:task-card}`. If no template is specified, the system picks a default based on the slot position.

The `where:` prop filters multi-value relation fields before rendering:

```markdown
### To do
{milestoneTasks|where:status=pending|template:task-item}

### In progress
{milestoneTasks|where:status=active|template:task-item}

### Completed
{milestoneTasks|where:status=complete|template:task-item}
```

**Rendering**: Entities are filtered by the predicate before rendering. When no entities match, the slot produces no output.

**Extraction**: Entities under a `where:`-filtered section automatically inherit the filter's field values (e.g., a task listed under "In progress" gets `status: active`). When the same relation field appears in multiple `where:` sections, extracted entities are concatenated.

### Preamble (Frontmatter)

Templates can declare a `preamble` — a list of fields rendered as YAML frontmatter at the top of the file:

```yaml
key: milestone-template
type: Template
preamble: [key, status, dueDate, relatedFeatures]
templateContent: |
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

Rendered files are **snapshots** — tracked by the system with version metadata. The synchronisation cycle:
1. **Render**: Navigation triggers a query, resolves file paths, renders templates, saves snapshots
2. **Detect changes**: System monitors snapshot files for external edits
3. **Extract**: Modified files are parsed to extract field values from the document structure
4. **Diff**: Extracted values are compared against current entity state
5. **Update**: Differences generate a transaction that updates the source entities

# Views

A `View` is a config entity that defines how an entity renders to markdown and how edits to that markdown extract back into structured data. Defined in transactions alongside `Field` and `Type`.

Source: `packages/cli/src/document/view.ts`, `view-entity.ts`, `extraction.ts`. Full concept doc: `docs/concepts/view.md`.

## Minimal Shape

```yaml
- author: system
  configs:
    - key: task-view
      type: View
      preamble: [key, status, priority, parent]
      viewContent: |
        # {title}

        {description}

        ## Details
        {details}
```

`viewContent` is a markdown template with field slots. `preamble` lists fields rendered as YAML frontmatter.

## Field Slots

Placeholders replaced with field values. Syntax: `{path|prop1|prop2:value|prop3:"quoted value"}`.

- **Standard**: `{title}`
- **Nested** (max depth 2): `{parent.title}`, `{project.status}`. Cannot use `{multiRelation.multiValueField}`
- **Sub-view**: `{tasks|view:task-card}`
- **Escaping**: `{{literal}}` renders as `{literal}`
- **Code blocks**: slots inside fenced or inline code are not processed

### Pipe-delimited props

| Form | Parsed as |
|---|---|
| `{f\|highlight}` | `{ highlight: true }` (flag) |
| `{f\|view:task-card}` | `{ view: "task-card" }` |
| `{f\|prop:a,b}` | `{ prop: ["a", "b"] }` |
| `{f\|where:"a=1,b=2"}` | `{ where: "a=1,b=2" }` |

Coercion: `true`/`false` → boolean, digits → number, quoted → unquoted string, else string.

## Slot Positions

Position is auto-detected from where the slot sits in the template. It controls render and extraction behaviour.

- **Inline** — shares a line with other content. Replaces only the slot text. `Author: {author.name}`
- **Block** — alone in a paragraph. Whole paragraph replaced; sub-view controls formatting
- **Section** — alone in a paragraph immediately before a header (or at end of document). Used for lists that need their own subsections
- **Document** — only content in the body. View has full control

## View Formats

Match text formats; smaller fits into larger:

- **document** — full page with headings
- **section** — reusable section under a heading
- **block** — paragraph-level
- **line** — single line, list items

A `line` view fits anywhere; a `section` view cannot fit an inline slot.

## Filtering Multi-value Relations

`where:` filters relation children before rendering:

```markdown
### To do
{milestoneTasks|where:status=pending|view:task-item}

### In progress
{milestoneTasks|where:status=active|view:task-item}
```

**Render**: only matching entities appear. Empty match → no output.

**Extraction**: entities under a `where:`-section inherit the filter values. A task listed under "In progress" extracts back with `status: active`. Multiple `where:` sections on the same field concatenate on extraction.

## Type Resolution When Creating Relation Children

When a new item appears in a sub-view and sync needs to create it, type is resolved in this order:

1. Explicit `{type}` slot rendered in the sub-view
2. Field's global `range`, if exactly one type
3. Parent type's `only` constraint on that field, if exactly one type

If none of these uniquely identifies a type, sync fails. Fix by rendering `{type}` in the sub-view, narrowing `range`, or adding `only: SingleType` on the parent's field.

## Preamble (Frontmatter)

```yaml
preamble: [key, status, dueDate, relatedFeatures]
```

Renders as YAML frontmatter at top of file. Null/undefined values omitted. Frontmatter fields take precedence over body fields with the same key during extraction.

## Bidirectional Sync

Rendered files are **snapshots** with version metadata. Lifecycle:

1. Navigation query → render via view → save snapshot
2. User edits the file
3. System extracts field values from document structure
4. Diff against entity → emit transaction → update entity

Files are the editing surface; entities remain the source of truth.

## Composition Example

Document view embedding a section view embedding line views:

```yaml
- key: task-line
  type: View
  viewContent: "- [{status}] {title}"

- key: task-section
  type: View
  viewContent: |
    ## Tasks
    {tasks|view:task-line}

- key: milestone-view
  type: View
  preamble: [key, status, dueDate]
  viewContent: |
    # {title}

    {description}

    {tasks|view:task-section}
```

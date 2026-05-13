# Views

A `View` is a config entity that defines how an entity renders to markdown and how edits to that markdown extract back into structured data. Defined in transactions alongside `Field` and `Type`.

## Example Shape

```yaml
- author: system
  configs:
    - key: task-view
      type: View
      preamble: [key, status, priority]
      viewContent: |
        # {title}

        {description}
        
        ## Parent: {parent.title}
        
        {parent.description}

        ## Details
        {details}
```

`viewContent` is a markdown template with field slots. `preamble` lists fields rendered as YAML frontmatter.

## Field Slots

Placeholders replaced with field values.

- **Standard**: `{title}`
- **Nested** (max depth 2): `{parent.title}`, `{project.status}`. Can only use on single value relational fields
- **Sub-view**: `{tasks|view:task-card}`
- **Sub-view with query**: `{tasks|where:status=pending|view:task-item}`
- **Escaping**: `{{literal}}` renders as `{literal}`
- **Code blocks**: slots inside fenced or inline code are not processed

## Slot Positions

Position is auto-detected from where the slot sits in the template. It controls render and extraction behaviour, and which field formats can render in the slot.

- **Inline** — shares a line with other content. Replaces only the slot text. `Author: {author.name}`
- **Block** — alone in a paragraph, surrounded by other paragraphs
- **Section** — inside heading scope: followed by a heading, or with a heading earlier in the file. Bounded by the next heading at the same depth or end-of-doc
- **Part** — rule-bounded: a `---` on at least one side separates the slot from surrounding content. Dominates any heading scope around it
- **Document** — only content block in the file (frontmatter aside)

### Format / Slot Compatibility

**General rule**: a richer richtext format needs a wider slot. For multi-value fields, if the item delimiter would collide with the slot's boundary, the slot must be wider still.

Practical guidance:

- **Single-value `block`** is the safe default for short rich text — works in any non-inline slot.
- **Multi-value `block` and any `section`-format field** need to live under a heading or after `---`. `section` also requires `sectionDepth` to set the parent heading level (e.g. `2` for content under `##`).
- **`document` format** must be the only content in the file, or wrapped in `---` separators (a `part` slot).
- **Multi-value `document`** can only render alone in a file — the item delimiter is `---` and would clash with any surrounding `---`.
- When in doubt, drop to a tighter format. A `section` field with `sectionDepth: 2` usually composes more flexibly than `document` for entity bodies.

A View's own `viewFormat` (declared on the View config) uses the same scale: a sub-view referenced via `{field|view:my-view}` must be format-compatible with the slot it's embedded in. A `line` view fits anywhere; a `section` view cannot fit an inline slot.

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

## Preamble (Frontmatter)

```yaml
preamble: [key, status, dueDate, relatedFeatures]
```

Renders as YAML frontmatter at top of file.

- Flat field keys only — nested paths like `parent.title` are not supported in preamble.
- Order in the list controls field order in the rendered YAML.
- Null/undefined values are omitted (no `field: null` keys in output).
- Frontmatter fields take precedence over body fields with the same key during extraction — don't render the same field in both places.

## Bidirectional Sync

Rendered files are **snapshots** with version metadata. Lifecycle:

1. Navigation query → render via view → save snapshot
2. User edits the file
3. System extracts field values from document structure
4. Diff against entity → emit transaction → update entity

Files are the editing surface; entities remain the source of truth.

### Resolving entity types for new children

When a user adds a new item under a relation sub-view, sync needs to know what type to create. Resolution order:

1. Explicit `{type}` slot rendered in the sub-view.
2. Field's global `range`, if exactly one type.
3. Parent type's `only` constraint on that field, if exactly one type.

If none of these uniquely identifies a type, sync fails. Fix by rendering `{type}` in the sub-view, narrowing `range`, or adding `only: SingleType` on the parent's field.

## Authoring Conventions

- **Inline** simple scalars: `{title}`, `Author: {author.name}`. Anything that fits on a line of prose.
- **Sub-views** (`{tasks|view:task-card}`) for repeated structures and any multi-value relation. Don't duplicate layout across parent views.
- **Nested paths** (`{parent.title}`) only work for single-value relations, one level deep. For multi-value or deeper access, use a sub-view.
- **Preamble** for metadata: keys, statuses, dates, single-value relations. **Body** for prose, headings, multi-value structured content. Pick one location per field.
- Name views by entity + granularity: `task-view`, `task-list-item`, `task-card`. Reuse list-item views as sub-views inside parent views.
- Prefer tighter formats. A `block` or `section` field composes anywhere; a `document` field forces special slot placement and is harder to embed.

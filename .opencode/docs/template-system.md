# Template System

The template system enables dynamic rendering of information into Markdown documents. Templates define how data are displayed and how content is extracted back into structured data.

## Field Extraction & Round-trip Editing

A core feature of the template system is **bidirectional conversion**. Not only can you render data into Markdown, but you can also extract field values back from Markdown documents.

This enables round-trip editing:
1.  **Render** data into a document
2.  **Edit** the text, numbers, or structure in the document
3.  **Extract** the updated values back into the database

The specific formatting rules described below exist to ensure this extraction is reliable and ambiguous data (like where one item ends and the next begins) is handled correctly.

## Field Slots

Field slots are placeholders in templates that get replaced with actual field values.

### Basic Syntax

- **Standard**: `{fieldName}`
- **Nested**: `{parent.title}`, `{project.status}`
- **With template**: `{tasks|template:task-card}`
- **Escaping**: `{{literal}}` -> `{literal}`

### Field Expression Syntax

Field slots support an expression syntax with a **path** and optional **pipe-delimited properties** (props):

```
{path|prop1|prop2:value|prop3:"quoted value"}
```

**Path**: Dot-separated field key, e.g. `fieldName` or `parent.child`.

**Props**: Each prop is separated by `|`. A prop can be:
- **Flag**: `{field|highlight}` → `{ highlight: true }`
- **Single value**: `{field|template:task-card}` → `{ template: "task-card" }`
- **Multiple args**: `{field|prop:arg1,arg2}` → `{ prop: ["arg1", "arg2"] }`
- **Quoted value**: `{field|where:"a=1,b=2"}` → `{ where: "a=1,b=2" }` (commas protected)

**Value coercion rules**:
- `true` / `false` → boolean
- Digits (e.g. `5`, `3.14`) → number
- Quoted strings (`"..."` or `'...'`) → string with quotes stripped
- Everything else → string

Commas separate multiple arguments: `prop:a,b` → `["a", "b"]`. Use quotes to pass a single value containing commas: `prop:"a,b"` → `"a,b"`.

Props are accumulated left-to-right into a single object.

**Implementation**: `packages/cli/src/document/field-expression-parser.ts`

#### Supported Props

| Prop | Type | Description |
|------|------|-------------|
| `template` | string | Sub-template key for rendering relation items |
| `where` | string | Filter multi-value relations by field values (see below) |

### Nested Field Access

Access fields from related entities using dot notation:

| Syntax | Description |
|--------|-------------|
| `{parent.title}` | Field from parent entity |
| `{children.summary}` | Field from each child (renders all values) |
| `{project.status}` | Field from single relation |
| `{tasks.title}` | Field from each item in multi-value relation |

**Limitations**:
- Maximum depth is 2 levels (e.g., `{parent.field}` works, `{parent.child.field}` does not)
- Cannot use `{multiRelation.multiValueField}` (both being multi-value)

### Code Blocks

Field slots are **not processed** inside code blocks (inline or fenced). This avoids conflicts with languages that use `{...}` syntax (JavaScript, Bash, etc.).

```javascript
// This {name} will NOT be replaced - code blocks are raw
const config = {
  name: "{literal}"
};
```

## Text Formats

Both fields and templates use formats that control structure and delimiters. The same format names apply to `richtextFormat` (on fields) and `templateFormat` (on templates).

| Format | Description | Constraints | 
|--------|-------------|-------------|
| `line` | Single line of text | No line breaks |
| `block` | Single content block (paragraph, list, etc.) | No blank lines, no headers |
| `section` | Content section with header | Must start with header, no `---` |
| `document` | Full document structure | No horizontal rules |

**Compatibility Rule**: Content of a smaller format can be used in a larger slot position.
*   A `line` template can be used anywhere.
*   A `block` template can be used in block, section, or document slots.
*   A `section` template cannot be used inside a paragraph (inline or block position).

## Multi-value Fields

Fields with `allowMultiple: true` store arrays of values. Each value follows the field's format constraints, and values are separated by format-specific delimiters:

| Format | Delimiter Between Values |
|--------|-------------------------|
| `line` | newline (`\n`) |
| `block` | blank line |
| `section` | header |
| `document` | horizontal rule (`---`) |

**Example**: A field with `richtextFormat: block` and `allowMultiple: true` can store multiple paragraphs or lists, each separated by a blank line.

```yaml
# Field definition
- key: steps
  type: Field
  dataType: richtext
  richtextFormat: block
  allowMultiple: true

# Stored value (array of blocks)
steps:
  - "First step with **formatting**"
  - "Second step\n- with a list\n- inside it"
```

## Slot Positions

The system automatically detects where a field slot appears in your document. This determines how the content is rendered and replaced.

### 1. Inline Position
The slot is part of a sentence or shares a line with other content.
*   **Behavior**: Replaces only the slot text.
*   **Example**: `Author: {author.name}`

### 2. Block Position
The slot is the **only content** in a paragraph.
*   **Behavior**: The entire paragraph is replaced by the rendered content. This allows the template to control its own formatting (like lists or code blocks) without being constrained by the surrounding paragraph tag.
*   **Example**:
    ```markdown
    Task Details:
    
    {description}
    ```

### 3. Section Position
The slot is a paragraph immediately preceding a header (or at the end of a document).
*   **Behavior**: Similar to block, but often used for lists of items that need their own subsections.
*   **Example**:
    ```markdown
    ## Tasks
    {tasks}
    ## Next Steps
    ```

### 4. Document Position
The slot is the only content in the entire document body.
*   **Behavior**: The template has full control over the document structure.

## Defining Templates

Templates are defined in the `./binder/templates` directory

```markdown
---
key: task-card
title: Task Card
description: Task Card
templateFormat: block
---

**{title}** ({status})
{description}
```

## Relation Fields

When rendering related items (e.g., `{tasks}`), you can specify which template to use:

```markdown
{tasks|template:task-card}
```

If no template is specified, the system picks a default based on the **Slot Position**.

### Filtering with `where:`

The `where:` prop filters multi-value relation fields by entity field values before rendering. This enables grouping related entities into separate sections based on status or any other field.

**Syntax**: `{field|where:key=value}` or `{field|where:key1=value1 AND key2=value2}`

Quotes are optional unless the filter string contains commas (which would otherwise be parsed as multiple prop arguments). Use `AND` to separate multiple conditions.

```markdown
## Tasks to do

{milestoneTasks|where:status=pending|template:task-item}

## In progress

{milestoneTasks|where:status=active|template:task-item}

## Completed tasks

{milestoneTasks|where:status=complete|template:task-item}
```

**Rendering behavior**:
- Entities are filtered by the `where:` predicate before rendering
- When no entities match the filter, the slot produces no output (the paragraph is removed entirely, no blank lines)
- The same relation field can appear multiple times in a template with different `where:` filters

**Extraction behavior**:
- When extracting from a document, entities under a `where:`-filtered section automatically inherit the filter's field values (e.g., a task listed under "In progress" gets `status: active`)
- When the same relation field appears in multiple `where:` sections, extracted entities are concatenated into a single array

**Includes resolution**:
- Field keys referenced in `where:` filters are automatically added to the relation's database query includes, so filtered fields are fetched without manual configuration

**Filter string format**: Uses the same `key=value` format as navigation `where` filters and `parseStringQuery`. Multiple conditions are separated by ` AND ` or `,`. Values are compared as strings (string equality only).

## YAML Front Matter (Preamble)

Templates can specify a `preamble` field — an array of field keys that are rendered as YAML front matter at the top of the document, rather than in the Markdown body.

```yaml
- key: task-template
  type: Template
  templateFormat: document
  preamble: [status, priority, dueDate, milestone, feature]
  templateContent: |
    # {title}

    {description}
```

This renders as:

```markdown
---
status: active
priority: high
dueDate: "2025-03-01"
---

# My Task

Task description here
```

**Rendering**: Fields listed in `preamble` are pulled from the entity and rendered as YAML front matter. Null/undefined values are omitted. If all preamble fields are null, no front matter block is added.

**Extraction**: When a template has a `preamble`, the front matter block is parsed and its fields are merged into the extracted entity alongside fields from the Markdown body. Front matter fields take precedence over body fields with the same key.

**Includes**: Preamble field keys are automatically added to the template's includes, so they are fetched from the database without needing to reference them in the template content.

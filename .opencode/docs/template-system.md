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

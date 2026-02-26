---
status: active
description: Format constraints for text field values that control structure, validation, and multi-value delimiters. Applies to both plaintext and richtext data types. Formats range from single words to full documents, with each level adding structural capabilities.
alternativeNames: [ format, field format ]
tags: [ data-model ]
sourceFiles: [ packages/db/src/model/text-format.ts ]
---

# Text Format

### Overview

Text formats define the structural constraints on text field values. Every plaintext and richtext field has a format that determines what content is allowed and how multiple values are delimited. Formats form a hierarchy from most constrained (identifier/word) to least constrained (document).

### Plaintext Formats

Plaintext formats are for unformatted text without markdown:
- **identifier** — Programmatic identifier starting with a letter, containing letters, digits, hyphens, and underscores (e.g., `my-item_v2`). Delimiter: comma
- **word** — Single word without whitespace. Delimiter: comma
- **phrase** — Short text without delimiter punctuation (no commas, semicolons, pipes, or line breaks). Delimiter: comma
- **line** — Single line of text, any punctuation allowed. Delimiter: newline
- **paragraph** — Multiple lines without blank lines. Delimiter: blank line
- **uri** — Valid URI with scheme (e.g., `https://example.com`). Delimiter: newline
- **filepath** — POSIX file path, absolute or relative. Delimiter: newline
- **semver** — Semantic versioning format (e.g., `1.2.3`). Delimiter: comma

### Richtext Formats

Richtext formats are for markdown-formatted content:
- **word** — Single styled word without spaces. Delimiter: comma
- **phrase** — Short text with formatting, no delimiter punctuation. Delimiter: comma
- **line** — Single line with inline formatting, no line breaks. Delimiter: newline
- **block** — Single content block (paragraph, list, or code block). No headers, blank lines, or horizontal rules allowed. Delimiter: blank line
- **section** — Content section within a heading hierarchy. Requires `sectionDepth` to specify the heading level. Only headers deeper than `sectionDepth` are allowed. No horizontal rules. Delimiter: header
- **document** — Complete document with full structure including headers. No horizontal rules (they serve as delimiters). Delimiter: horizontal rule (`---`)

### Multi-value Delimiters

Fields with `allowMultiple: true` store arrays of values. Each value follows the field's format constraints, and values are separated by format-specific delimiters:

| Format                           | Delimiter                  |
| -------------------------------- | -------------------------- |
| identifier, word, phrase, semver | comma                      |
| line, uri, filepath              | newline                    |
| paragraph, block                 | blank line                 |
| section                          | header at sectionDepth + 1 |
| document                         | horizontal rule (`---`)    |

### Section Depth

The `sectionDepth` parameter on section-format fields controls which headers are allowed in content. A `sectionDepth` of 2 means the content lives under an `##` heading, so only `###` and deeper headers are permitted. This ensures rendered content doesn't break the document's heading hierarchy.

### Validation

Each format has a validator that checks content against its constraints. Validators strip fenced code blocks before checking for structural elements (headers, horizontal rules), so code examples don't trigger false validation errors.

### Compatibility Rule

Content of a smaller format can be used in a larger slot position. A line value can appear anywhere a block or document is expected. A section value cannot be used in an inline or block position.

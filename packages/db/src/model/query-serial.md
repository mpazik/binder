# Query Serial Format

Compact text representations for each `QueryParams` field. Designed for CLI arguments, URL parameters, and other
text-based interfaces where the full JSON format is cumbersome.

Each query parameter has its own independent serial format. Interfaces compose them as separate arguments — they are
never combined into a single string.

See [query.md](./query.md) for the canonical JSON format. The serial format is a lossy subset — advanced features
(logical operators, computed fields, IncludesQuery with nested filters) require the full JSON form.

## Filters

### Grammar

```
filters     = (filterExpr | plainText)+
filterExpr  = fieldName operator value
plainText   = (text without "=")        → maps to $text filter

operator    = "=" | "!=" | ">" | ">=" | "<" | "<="
            | ":in=" | ":notIn=" | ":match=" | ":contains=" | ":notContains="
            | ":empty" | ":notEmpty"
```

Symbolic operators (`=`, `!=`, `>=`, etc.) for common comparisons. Colon-prefixed names (`:in=`, `:match=`, etc.) for
the rest. Filters are separated by spaces — each pair maps to one entry in the JSON `filters` object.

### Examples

```
type=Task status=done priority>=3
```
```json
{ "type": "Task", "status": "done", "priority": { "op": "gte", "value": 3 } }
```

```
status:in=open,in-progress title:match=urgent assignee:empty
```
```json
{ "status": { "op": "in", "value": ["open", "in-progress"] }, "title": { "op": "match", "value": "urgent" }, "assignee": { "op": "empty", "value": true } }
```

```
deployment issues type=Task
```
```json
{ "$text": "deployment issues", "type": "Task" }
```

### Notes

- Values are auto-coerced: `true`/`false` → boolean, integer/float patterns → number, everything else → string.
- Plain text tokens (without `=`) are joined and mapped to the `$text` full-text search filter. This is specific to the
  CLI search command — the `$text` key is a virtual filter that triggers FTS matching across indexed text fields. It is
  not a regular field name.
- Does not support: logical operators (`$or`, `$and`), multiple conditions on the same field. Use JSON format for these.

## Includes

### Grammar

```
includes    = fieldList
fieldList   = fieldExpr ("," fieldExpr)*
fieldExpr   = fieldName ( "(" fieldList ")" )?
fieldName   = [a-zA-Z_][a-zA-Z0-9_]*
```

Parentheses select sub-fields of a relationship, nesting recursively. A field name without parentheses maps to `true`.

### Examples

```
title,status,tags
```
```json
{ "title": true, "status": true, "tags": true }
```

```
project(title,owner(name,email)),comments(body,author(name)),tags
```
```json
{
  "project": { "title": true, "owner": { "name": true, "email": true } },
  "comments": { "body": true, "author": { "name": true } },
  "tags": true
}
```

### Notes

- Whitespace around commas and parentheses is allowed and ignored.
- Does not support: IncludesQuery (nested filters on relationships), excluding fields (`false` values). Use JSON format
  for these.

## OrderBy

### Grammar

```
orderBy     = orderExpr ("," orderExpr)*
orderExpr   = "!"? fieldName
```

### Examples

```
!priority,createdAt
```
```json
["!priority", "createdAt"]
```

### Notes

- `!` prefix means descending order. No prefix means ascending.
- The serial and JSON representations are identical — the serial format simply joins/splits on commas.

## Pagination

Pagination parameters are naturally scalar (`limit`, `after`, `before`) and do not need a serial format. They are passed
as separate named arguments in all interfaces.

## Interface Composition

Each interface composes the serial formats as separate arguments.

### CLI

```bash
binder search type=Task status=done -i "project(title,status),tags" -o "!priority" --limit 20
binder read my-task -i "project(title),tags"
```

### Navigation Config (YAML)

```yaml
# Serial form
- path: "tasks/{key}"
  where: { type: Task }
  includes: "title,status,project(title)"

# Full JSON form still supported for advanced cases
- path: "reviewed/{key}"
  where: { type: Task }
  includes:
    comments:
      includes: { body: true, author: true }
      filters: { status: approved }
```

### Templates

```markdown
# {title}

{comments | includes: "body,author(name)"}
{tasks | where: "status=active,priority>=3" | includes: "title,assignee(name)"}
```

## Design Rationale

**Separate formats per parameter.** Mirrors how the JSON format already separates `filters`, `includes`, `orderBy`, and
`pagination`. Different interfaces naturally want different composition — CLI uses positional args for filters and flags
for the rest; YAML configs may only need `includes`; templates use pipe syntax.

**Parentheses for includes.** Shell-safe (unlike `{}` which triggers brace expansion), YAML-safe (unlike `{}` which
means inline mapping), compact (`project(title,status)` vs repeating `project.title,project.status`), and proven (Google
APIs use this syntax across their ecosystem).

**Serial as a lossy subset.** Advanced features — logical operators, IncludesQuery with nested filters, computed
fields — require the full JSON/YAML form. The serial format targets the common case: quick human-authored queries.

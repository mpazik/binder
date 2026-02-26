---
status: active
description: A structured request for entities from the repository. Supports filters, nested includes, ordering, cursor-based pagination, computed fields, and full-text/vector search. Inspired by GraphQL and JOQL.
alternativeNames: [ search, filter ]
tags: [ data-access ]
sourceFiles: [ packages/db/src/model/query.ts, packages/db/src/model/query-serial.ts ]
relatesTo: [ 1jgIHtJoM1M, 7RVmgYuEPQI ]
---

# Query

### Overview

A query is a structured request for entities from the repository. The format is JSON-based (inspired by GraphQL and JOQL), designed to be schema-validatable, LLM-friendly, and expressive enough for complex data access without raw SQL. Queries drive views, navigation, CLI output, and API responses.

### Two Modes

#### Get Single Entity

Retrieve one entity by reference (UID, key, or ID) with optional field selection:

```json
{ "ref": "my-task", "includes": { "title": true, "project": { "includes": { "name": true } } } }
```

#### List Entities

Query multiple entities with filters, includes, ordering, and pagination:

```json
{ "filters": { "type": "Task", "status": "active" }, "includes": { "title": true }, "orderBy": ["!priority"], "pagination": { "limit": 20 } }
```

### Filters

Filters constrain which entities are returned. Simple equality uses direct values; complex conditions use operator objects:

**Common operators** (all types): `eq`, `not`, `in`, `notIn`, `empty`
**String operators**: `contains`, `notContains`, `match` (full-text search)
**Number/date operators**: `lt`, `lte`, `gt`, `gte`

```json
{ "status": "active", "priority": { "op": "gte", "value": 3 }, "tags": { "op": "in", "value": ["urgent", "important"] } }
```

### Includes

The `includes` parameter controls which fields appear in the response. When omitted, all fields are returned. When specified, only requested fields are included. Includes nest recursively for relations, and can apply filters to related entities:

```json
{ "includes": { "title": true, "comments": { "includes": { "body": true, "author": { "includes": { "name": true } } }, "filters": { "status": "approved" } } } }
```

### Ordering and Pagination

- **orderBy** — field names with `!` prefix for descending: `["!priority", "createdAt"]`
- **pagination** — cursor-based with `limit`, `after`, `before`. Cursor-based pagination provides consistent results even when data changes between pages.

### Extensions

#### Logical Operators

`$and`, `$or`, `$not` for complex filter composition. The `$` prefix avoids collision with user field names. Root-level filters are implicitly `$and`.

#### Search

- `match` — full-text search via FTS5
- `similar` — vector similarity (semantic/embedding-based)
- `search` — hybrid combining both

#### Computed Fields

Defined in a `computed` section, calculated at query time, referenceable in filters and orderBy:
- **Aggregation**: `count`, `sum`, `avg`, `min`, `max`
- **Collection**: `concat`, `collect`
- **Boolean**: `every`, `some`
- **Temporal**: `earliest`, `latest`

Computed fields are only included in the response when explicitly listed in `includes`.

### Serial Format

A compact text representation for CLI, URLs, and templates — a lossy subset of the full JSON format. Each query parameter has its own independent serial grammar:
- **Filters**: `type=Task status=done priority>=3` or `deployment issues type=Task` (plain text triggers full-text search)
- **Includes**: `title,status,project(title,owner(name,email))` (parentheses for nested selection)
- **OrderBy**: `!priority,createdAt` (same as JSON)

```bash
binder search type=Task status=done -i "project(title),tags" -o "!priority" --limit 20
```

Advanced features (logical operators, computed fields, nested include filters) require the full JSON/YAML form.

### Design Rationale

- **JSON format** — schema-validatable, LLM-friendly, structured for programmatic construction
- **Naming convention** — top-level fields use nouns (`filters`, `includes`, `orderBy`); operators use verbs (`count`, `match`, `contains`)
- **Nested includes** — fetch exactly what's needed in one request, like GraphQL but simpler
- **Cursor pagination** — stable under concurrent modification, unlike offset-based
- **Serial as lossy subset** — optimised for the common case; power users use JSON

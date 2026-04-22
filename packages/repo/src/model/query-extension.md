## Extension Proposal

This document extends the base query format with advanced features for logical operations, search, and aggregations. All
operators follow the naming convention: verbs or action-oriented names that describe what the operation does (e.g.,
`count`, `sum`, `match`, `search`).

### Logical Operators

- `$and` - All conditions must match (implicit at root level)
- `$or` - Any condition must match
- `$not` - Negates a condition or group

The `$` prefix is needed to avoid conflict with user fields which those names.

### Search Operators

- `match` - Full-text search using FTS5 (supports `+term`, `"phrase"`, `-exclude`, `term*`)
- `similar` - Vector similarity search (semantic/embedding-based)
- `search` - Hybrid search (with `type`: `"fulltext"`, `"vector"`, or `"hybrid"`)

### Computed Fields and Relation Aliases

Computed fields and relation aliases are defined inline in `includes`. The `relation` property is the discriminator: if
present, the entry is a computed/derived field rather than a direct field reference. The key becomes the response name.

This covers two use cases:

1. **Aggregations** - count, sum, avg, etc. over a relation.
2. **Relation aliases** - filtered projections of a relation under a new name. Needed when the same relation is split by
   type (e.g., `relatesTo` filtered to Tasks vs Notes).

**Aggregation operators:**

**Count:** `count`
**Numeric:** `sum`, `avg`, `min`, `max`
**String:** `concat`, `collect`
**Boolean:** `every`, `some`
**Date:** `earliest`, `latest`

#### Relation Alias Examples

A relation alias uses `relation` to point at the source field, with optional `filters` and nested `includes`:

```json
{
  "includes": {
    "relatedTasks": {
      "relation": "relatesTo",
      "filters": { "type": "Task" },
      "includes": { "title": true, "status": true }
    },
    "relatedNotes": {
      "relation": "relatesTo",
      "filters": { "type": "Note" },
      "includes": { "title": true, "body": true }
    }
  }
}
```

Without aliasing, two filtered views of `relatesTo` would collide on the same response key. The alias gives each a
distinct name.

#### Referencing Computed Fields in Filters and OrderBy

Computed fields defined in `includes` can be referenced by name in `filters` and `orderBy`:

```json
{
  "includes": {
    "title": true,
    "commentCount": { "op": "count", "relation": "comments" }
  },
  "filters": {
    "commentCount": { "op": "gt", "value": 5 }
  },
  "orderBy": ["!commentCount"]
}
```

If a computed field is needed for filtering/sorting but not wanted in the response, a future `"include": false` flag
could suppress it from output. Not designed yet - handling this when a real need arises.

#### Design Rationale

Computed fields live in `includes` rather than a separate `computed` section because:

- Avoids declaring every computed field twice (once to define, once to include).
- The common case is compute-and-return. Compute-without-returning is rare enough to handle later.
- `relation` property cleanly discriminates computed entries from direct field references.

> **Naming note:** Putting computed fields in `includes` is slightly awkward since some entries define new fields rather
> than "include" existing ones. Renaming `includes` to `fields` or `select` would be more accurate. Worth considering
> when the extension is implemented.

### Complete Example

```json
{
  "includes": {
    "title": true,
    "status": true,
    "avgRating": { "op": "avg", "relation": "reviews", "field": "score" },
    "commentCount": { "op": "count", "relation": "comments" },
    "approvedComments": {
      "op": "count",
      "relation": "comments",
      "filters": { "status": "approved" }
    },
    "totalHours": { "op": "sum", "relation": "timeEntries", "field": "hours" },
    "tagList": { "op": "concat", "relation": "tags", "field": "name", "separator": ", " },
    "allDone": { "op": "every", "relation": "subtasks", "field": "completed" },
    "lastUpdate": { "op": "latest", "relation": "comments", "field": "createdAt" },
    "relevance": {
      "op": "search",
      "type": "hybrid",
      "query": "deployment issues",
      "fields": ["title", "description"],
      "relations": { "comments": ["content"] }
    },
    "relatedTasks": {
      "relation": "relatesTo",
      "filters": { "type": "Task" },
      "includes": { "title": true, "priority": true }
    },
    "project": { "includes": { "name": true } }
  },
  "filters": {
    "status": "active",
    "relevance": { "op": "gte", "value": 0.7 },
    "commentCount": { "op": "gt", "value": 5 },
    "$or": [
      { "priority": { "op": "gte", "value": 4 } },
      {
        "$and": [
          { "assignee": { "op": "empty", "value": true } },
          { "avgRating": { "op": "gte", "value": 4.0 } }
        ]
      }
    ]
  },
  "orderBy": ["!relevance", "!commentCount"]
}
```

**Response:**
```json
{
  "data": [
    {
      "title": "Fix deployment script",
      "status": "open",
      "avgRating": 4.2,
      "commentCount": 12,
      "approvedComments": 8,
      "totalHours": 23.5,
      "tagList": "urgent, devops",
      "allDone": false,
      "lastUpdate": "2026-03-14T10:30:00Z",
      "relevance": 0.85,
      "relatedTasks": [
        { "title": "Update CI pipeline", "priority": "p1" }
      ],
      "project": { "name": "DevOps" }
    }
  ]
}
```

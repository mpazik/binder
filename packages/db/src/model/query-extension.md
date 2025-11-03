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

### Computed Fields

Computed fields are defined in a separate `computed` section and calculated at query time. They can be referenced in
`filters`, `orderBy`, and optionally included in results via `includes`.

**Count:** `count`
**Numeric:** `sum`, `avg`, `min`, `max`
**String:** `concat`, `collect`
**Boolean:** `every`, `some`
**Date:** `earliest`, `latest`

#### Design Rationale

Separating computed field definitions from result selection allows:

- Filtering/sorting by computed values without including them in results
- Clear separation between field definition and selection
- Explicit control over response payload
- LLM-friendly predictability (what's in `includes` = what's in response)

### Complete Example

```json
{
  "computed": {
    "relevance": {
      "op": "search",
      "type": "hybrid",
      "query": "deployment issues",
      "fields": ["title", "description"],
      "relations": { "comments": ["content"] }
    },
    "commentCount": { "op": "count", "relation": "comments" },
    "approvedComments": { 
      "op": "count", 
      "relation": "comments",
      "filters": { "status": "approved" }
    },
    "avgRating": { "op": "avg", "relation": "reviews", "field": "score" },
    "totalHours": { "op": "sum", "relation": "timeEntries", "field": "hours" },
    "tagList": { "op": "concat", "relation": "tags", "field": "name", "separator": ", " },
    "allDone": { "op": "every", "relation": "subtasks", "field": "completed" },
    "lastUpdate": {
      "op": "latest",
      "relation": "comments",
      "field": "createdAt"
    }
  },
  "includes": {
    "title": true,
    "status": true,
    "commentCount": true,
    "avgRating": true,
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
      "commentCount": 12,
      "avgRating": 4.2,
      "project": { "name": "DevOps" }
    }
  ]
}
```

Note: `relevance`, `approvedComments`, `totalHours`, `tagList`, `allDone`, and `lastUpdate` are computed but not
included in the response because they're omitted from `includes`.

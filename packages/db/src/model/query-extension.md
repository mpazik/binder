## Extension Proposal

### Logical Operators

- `$and` - All conditions must match (implicit at root level)
- `$or` - Any condition must match
- `$not` - Negates a condition or group

The `$` prefix is needed to avoid conflict with user fields which those names.

### Search Operators

- `match` - Full-text search using FTS5 (supports `+term`, `"phrase"`, `-exclude`, `term*`)
- `similar` - Vector similarity search (semantic/embedding-based)
- `search` - Hybrid search (with `type`: `"fulltext"`, `"vector"`, or `"hybrid"`)

### Aggregation Operators (Computed Fields)

Computed fields are defined inline in `includes` and calculated at query time. They can be used in filters and orderBy.

**Count:** `count`
**Numeric:** `sum`, `avg`, `min`, `max`
**String:** `concat`, `collect`
**Boolean:** `every`, `some`
**Date:** `earliest`, `latest`

### Complete Example

```json
{
  "includes": {
    "title": true,
    "status": true,
    
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
    "lastUpdate": { "op": "latest", "relation": "comments", "field": "createdAt" },
    
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
      "relevance": 0.95,
      "commentCount": 12,
      "approvedComments": 8,
      "avgRating": 4.2,
      "totalHours": 15.5,
      "tagList": "urgent, deployment, devops",
      "allDone": false,
      "lastUpdate": "2024-01-15T10:30:00Z",
      "project": { "name": "DevOps" }
    }
  ]
}
```

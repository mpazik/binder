# Entity Query Format

Entity Query is Binder's query language based on JOQL (JSON Oriented Query Language) with modifications for entity-specific operations. It provides a structured way to query and manipulate entities.

## Overview

The query format is designed to:
- Query entities with advanced filtering capabilities
- Include related entities and attributes
- Support cursor-based pagination
- Provide type-safe operations with clear operator semantics

## Identifiers

Binder supports three types of identifiers:
- `id` - Internal database identifier (integer)
- `uid` - Unique identifier string (e.g., `u_abc123`, `t_xyz789`)
- `key` - Human-readable key/slug (e.g., `john-doe`, `urgent`)

When querying entities, use the `ref` parameter which accepts any of these identifier types.

## Query Structure

### Get Single Entity

Retrieves a single entity by reference with optional includes:

```json
{
  "ref": "entity-123",
  "includes": {
    "tags": true,
    "comments": {
      "includes" : {
        "author": {
          "includes": {
            "name": true
          }
        }
      },
      "filters": {
        "status": "published"
      }
    }
  }
}
```

### List Entities

Query multiple entities with filters, includes, ordering, and pagination:

```json
{
  "filters": {
    "type": "task",
    "status": {
      "op": "in",
      "value": [
        "open",
        "in-progress"
      ]
    },
    "priority": {
      "op": "gte",
      "value": 3
    },
    "title": {
      "op": "match",
      "value": "urgent"
    }
  },
  "includes": {
    "project": {
      "includes": {
        "name": true,
        "status": true
      }
    },
    "tags": true
  },
  "orderBy": [
    "!priority",
    "createdAt"
  ],
  "pagination": {
    "limit": 20,
    "after": "cursor-xyz"
  }
}
```

## Filter Operators

### Common Operators (All Types)
- `eq` - Equal to (exact match)
- `not` - Not equal to
- `in` - Match any value in an array
- `notIn` - Match none of the values in an array
- `empty` - Value is null or undefined

### String-Specific Operators
- `contains` - String contains substring
- `notContains` - String does not contain substring

### Number-Specific Operators
- `lt` - Less than
- `lte` - Less than or equal
- `gt` - Greater than
- `gte` - Greater than or equal

## Filter Examples

### Simple Equality
```json
{
  "filters": {
    "status": "active",
    "userId": 123
  }
}
```

### Complex Conditions
```json
{
  "filters": {
    "title": { "op": "match", "value": "project" },
    "priority": { "op": "gte", "value": 3 },
    "score": { "op": "lt", "value": 100 },
    "status": { "op": "in", "value": ["active", "pending"] },
    "type": { "op": "notIn", "value": ["archived", "deleted"] },
    "assignee": { "op": "empty", "value": true },
    "tags": { "op": "empty", "value": false }
  }
}
```

## Includes

The `includes` parameter specifies which related entities and attributes to include in the response.

**Note**: 
- If `includes` is not defined or omitted, all fields will be returned by default.
- When `includes` is specified, only the requested fields are returned. Identifier fields (`id`, `uid`, `key`) are not automatically included and must be explicitly requested.

### Basic Includes
```json
{
  "includes": {
    "author": true,
    "project": {
      "name": true,
      "status": true,
      "description": true
    }
  }
}
```

### Nested Includes with Filters
```json
{
  "includes": {
    "comments": {
      "content": true,
      "author": true,
      "filters": {
        "status": "approved",
        "rating": { "op": "gte", "value": 4 }
      }
    }
  }
}
```

## Response Format

### Single Entity Response
```json
{
  "tags": [
    {
      "id": "tag-1",
      "uid": "t_xyz789",
      "key": "documentation",
      "name": "Documentation",
      "color": "blue"
    }
  ],
  "comments": [
    {
      "author": {
        "name": "Jane Smith"
      }
    },
    {
      "author": {
        "name": "Bob Wilson"
      }
    }
  ]
}
```

### List Response
```json
{
  "data": [
    {
      "project": {
        "name": "Core Platform",
        "status": "active"
      },
      "tags": [
        {
          "id": "tag-1",
          "uid": "t_urgent01",
          "key": "urgent",
          "name": "Urgent",
          "color": "red"
        }
    },
    {
      "project": {
        "name": "Security Team",
        "status": "active"
      }
    }
  ],
  "pagination": {
    "hasNext": true,
    "hasPrevious": false,
    "nextCursor": "cursor-next-123",
    "previousCursor": null
  }
}
```

## Best Practices

1. **Use specific includes** - Only request fields you need to minimize payload size
2. **Filter early** - Apply filters at the query level rather than filtering results client-side
3. **Leverage cursor pagination** - Use cursor-based pagination for consistent results
4. **Combine operators** - Use multiple filter conditions for precise queries
5. **Order consistently** - Use stable sort fields (like ID) as final sort criteria
6. **Handle empty results** - Always check for empty data arrays in list responses

## Design rationale
Requirements:
- use JSON so we have schema for easy validation, and it is easier to use for LLMs 
- nested include to fetch only what we need
- nested filtering
- condition tree with `or` and `and`
- aggregation

Naming, all query fields are imperatives to make it logic, concise and similar to SQL. 

It is inspired by graphql and [GitHub: modql/joql-spec](https://github.com/modql/joql-spec), but it is simplified and more tailored for Binder

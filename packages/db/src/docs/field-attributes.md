# Field Attributes

Field attributes provide a mechanism to attach additional structured data to field values. This enables rich metadata, qualifiers, and context without creating separate entities or complicating the core data model.

## Core Principle

Field attributes extend field values with structured metadata while keeping storage flat and predictable. The field value itself remains simple and indexable, while attributes are stored in parallel using the naming convention `fieldName.attrs`.

## Key Concepts

1. **Attribute** - A config entity that defines a single property (like `role`, `percentage`, `confidence`)
2. **attributes** - Field property that lists which Attribute entities can be attached to field values
3. **Storage suffix** - Attributes always stored as `fieldName.attrs`
4. **Input format** - Concise syntax: `value: { attr1: x, attr2: y }`
5. **Validation** - Attributes validated against their schema definitions

## Common Use Cases

**Type level field constrains**: `required`, `exclude`, `only`
**Relationship metadata**: `role`, `percentage`, `priority`
**Dependency tracking**: `criticality`, `blockingType`
**Data provenance**: `source`, `confidence`, `fetchedAt`

## Applicable Data Types

Field attributes work best with **key-compatible data types** where the value can serve as an object key:

- **`relation`**: Entity references (UIDs, keys, IDs)
- **`string`**: Text values
- **`option`**: Enumeration values
- **`number`**: Numeric values (converted to string keys)
- **`date`**: ISO date strings

For complex data types (objects, arrays), use the explicit `value` key format.

## Design Principles

1. **Single Responsibility**: Each Attribute entity defines one property
2. **Reusability**: Attributes can be used across multiple fields
3. **Flat Storage**: Attributes stored as `fieldName.attrs` for predictable access
4. **Optional**: Fields work without attributes; attributes are additive
5. **Type-Safe**: Attributes validated against their schema definitions

## When to Use Separate Entities

Create a separate entity type instead of attributes when:
- The relationship has many properties (>5-6 attributes)
- The relationship needs its own lifecycle
- The relationship is queryable as a primary entity
- The relationship has relationships to other entities

## Complete Example

```yaml
# 1. Define Attributes
type: Attribute
key: role
dataType: string

---
type: Attribute
key: percentage
dataType: number
min: 0
max: 100

# 2. Reference from Field
type: Field
key: assignedTo
dataType: relation
range: [User]
attributes: [role, percentage]

# 3. Use in Entity
assignedTo:
  - user-1: { role: lead, percentage: 60 }
  - user-2: { role: reviewer, percentage: 40 }

# 4. Storage
{
  "assignedTo": ["user-1", "user-2"],
  "assignedTo.attrs": {
    "user-1": { "role": "lead", "percentage": 60 },
    "user-2": { "role": "reviewer", "percentage": 40 }
  }
}
```

## Future: Data-Type Extensions

The `.attrs` pattern could be generalized to support data-type-specific extensions using `fieldName.[extension-key]`. Each data type would define which extensions are available, enabling specialized storage and processing without creating separate entities:

**`relation` dataType**:
- `assignedTo.attrs` - Relationship metadata (role, percentage, priority)
- `parent.hierarchy` - Materialized path for hierarchical queries

**`text`|`string` dataType**:
- `content.embeddings` - Vector embeddings for similarity search
- `content.stems` - Stemmed words for full-text search

Extensions would be inherent to the data type's capabilities rather than declared per field. Some extensions might use specialized database indexes while others remain in JSON storage. This approach maintains the same flat, predictable storage pattern while enabling type-appropriate optimizations.

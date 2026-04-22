---
key: field-attribute
name: Field Attribute
tags: [ data-model ]
status: active
description: Structured metadata attached to a field value. Extends values with properties like role, percentage, or confidence while keeping storage flat and the base value indexable.
alternativeNames: [ attribute, value metadata, relation attribute ]
sourceFiles: [ packages/repo/src/model/field.ts, packages/repo/src/model/data-type.ts ]
relatesTo:
  - field
  - data-type
---

# Field Attribute

## Details

### Overview

A field attribute attaches structured metadata to a field value without complicating the value itself. The field value stays simple and indexable; the system stores attributes in parallel using a `fieldName.attrs` suffix. This keeps storage flat and predictable while enabling rich annotations on relationships and other values.

An **Attribute** is a config entity defining a single property like `role`, `percentage`, or `confidence`. Fields declare which attributes they support via the `attributes` property.

### Applicable Data Types

Attributes work with data types where the value can serve as an object key:
- **relation**: entity references (UIDs, keys)
- **string**: text values
- **option**: enumeration values
- **number**: numeric values (converted to string keys)
- **date**: ISO date strings

For complex data types (objects, arrays), use the explicit `value` key format.

### Usage

```yaml
# 1. Define attributes
- type: Attribute
  key: role
  dataType: string

- type: Attribute
  key: percentage
  dataType: number

# 2. Declare on field
- type: Field
  key: assignedTo
  dataType: relation
  range: [User]
  attributes: [role, percentage]

# 3. Use on entity
assignedTo:
  - user-1: { role: lead, percentage: 60 }
  - user-2: { role: reviewer, percentage: 40 }
```

Common use cases: relationship metadata (role, percentage), dependency tracking (criticality, blocking type), data provenance (source, confidence).

### When to Use Separate Entities

Create a separate entity type instead of attributes when:
- The relationship has many properties (more than 5-6)
- The relationship needs its own lifecycle
- The relationship is queryable as a primary entity
- The relationship has relationships to other entities

### Implementation

#### Storage

Attributes are stored alongside the field value using the `.attrs` suffix:

```json
{
  "assignedTo": ["user-1", "user-2"],
  "assignedTo.attrs": {
    "user-1": { "role": "lead", "percentage": 60 },
    "user-2": { "role": "reviewer", "percentage": 40 }
  }
}
```

The base value remains simple and indexable. Attributes are validated against their Attribute entity definitions.

Type-level field attributes are currently enforced for relation constraints and option-field `only` constraints, while broader attribute support is still evolving.

### Future: Data-Type Extensions

The `.attrs` pattern could generalise to data-type-specific extensions using `fieldName.[extension-key]`:
- **relation**: `.hierarchy` for materialised paths in hierarchical queries
- **text/string**: `.embeddings` for vector search, `.stems` for full-text search

Extensions would be inherent to the data type's capabilities, maintaining flat storage while enabling type-appropriate optimisations.

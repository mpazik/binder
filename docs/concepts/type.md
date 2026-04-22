---
key: type
name: Type
tags: [ data-model ]
status: active
description: A flexible entity class that provides identity, organisation, and field configuration without enforcing structure at the storage level. Types compose fields with constraints but don't own them.
alternativeNames: [ entity type, record type ]
sourceFiles: [ packages/repo/src/model/schema.ts, packages/repo/src/schema.ts ]
relatesTo:
  - field
  - entity
  - vocabulary
---

# Type

## Details

### Overview

A type classifies an entity and determines which fields are relevant, with what constraints, and how the entity is displayed. Types are deliberately **flexible**: they guide and validate but don't lock down storage.

This means:
- An entity's type can change without migrating data
- Any entity can hold any field regardless of its type
- Types suggest and validate, but don't prevent storage
- Structure emerges gradually as users add types to their vocabulary

### Role of Types

Types serve four purposes:
1. **Identity/Categorisation**: "This entity IS a Task"
2. **Query shortcuts**: "Show all Tasks", type is indexed for fast filtering
3. **Default view**: how the entity is displayed and rendered
4. **Field contextualisation**: which fields belong, with what constraints, and when

### Single Type per Entity

Each entity has exactly **one** type. This is a deliberate design choice:
- Every entity IS one thing, which provides mental clarity
- Avoids view merging complexity and conflicting constraints
- Use **relations** to link entities when concepts are connected, like Meeting → Decision
- Use **tags** for cross-cutting categorisation, hierarchical and multi-valued like `work/projects/binder`

### Conditional Fields

Instead of type inheritance, binder uses **conditional fields** to handle varying behaviour within a single type. A field declares relevance conditions using `{when: field=value}`:

```
TYPES:
• Field [
    name{required},
    dataType{required},
    range{when: dataType=relation},
    options{when: dataType=option}
  ]

• Task [
    title{required},
    status{default: todo},
    completedAt{when: status=done},
    cancelReason{when: status=cancelled, required}
  ]
```

Conditional fields apply to both validation and UI field visibility: a field is only shown and validated when its condition is met. This replaced type inheritance because:
- Inheritance conflicts with the flexible, gradually-structured philosophy
- Conditional fields keep everything in one type definition, no hierarchy to navigate
- The same mechanism works for both user-defined and system types. The Field type itself uses `{when}` for data-type-specific properties

### Type-Level Constraints

Types contextualise shared fields with optional constraints:
- `{required}`: field must have a value
- `{default: X}`: default value when not provided
- `{only: Type1|Type2}`: restrict relation targets or options to a subset
- `{exclude: value1|value2}`: remove specific options
- `{when: field=value}`: conditional field, only relevant when condition is met
- `{min: N, max: N}`: numeric or count range
- `{value: X}`: fixed constant

### Types vs Tags

- **Type**: single-valued, provides identity, has associated fields and views
- **Tags**: multi-valued, hierarchical like `work/projects/binder`, used for cross-cutting categorisation

---
status: active
description: A weak entity class that provides identity, organisation, and field contextualisation — but does not enforce structure at the storage level. Types compose fields with constraints; they don't own them.
alternativeNames: [ entity type, record type ]
tags: [ data-model ]
sourceFiles: [ packages/db/src/model/schema.ts, packages/db/src/schema.ts ]
relatesTo: [ 4zRN90q4XDM, 1jgIHtJoM1M, 3UzBoZGuDv0 ]
---

# Type

### Overview

A type classifies an entity ("this IS a Task") and determines which fields are relevant, with what constraints, and how the entity is displayed. However, types are deliberately **weak** — they are contextualizers, not enforcers. They provide an additional layer of configuration but don't impact the underlying storage structure.

This means:
- An entity's type can change without migrating data
- Any entity can hold any field regardless of its type
- Types suggest and validate, but don't prevent storage
- Structure emerges gradually as users add types to their vocabulary

### Role of Types

Types serve four purposes:
1. **Identity/Categorisation** — "This entity IS a Task"
2. **Query shortcuts** — "Show all Tasks" (type is indexed for fast filtering)
3. **Default view/template** — how the entity is displayed and rendered
4. **Field contextualisation** — which fields belong, with what constraints, and when

### Single Type per Entity

Each entity has exactly **one** type. This is a deliberate design choice:
- Every entity IS one thing — provides mental clarity
- Avoids template merging complexity and conflicting constraints
- Use **relations** to link entities when concepts are connected (e.g., Meeting → Decision)
- Use **tags** for cross-cutting categorisation (hierarchical, multi-valued, e.g., `work/projects/binder`)

### Conditional Fields

Instead of type inheritance, binder uses **conditional fields** to handle polymorphic behaviour within a single type. A field declares relevance conditions using `{when: field=value}`:

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

Conditional fields apply to both validation and UI field visibility — a field is only shown and validated when its condition is met. This replaced type inheritance (which was considered and rejected) because:
- Inheritance conflicts with the flexible, gradually-structured philosophy
- Conditional fields keep everything in one type definition — no hierarchy to navigate
- The same mechanism works for both user-defined types and system types (e.g., the Field type itself uses `{when}` for data-type-specific properties)

### Type-Level Constraints

Types contextualise shared fields with optional constraints:
- `{required}` — field must have a value
- `{default: X}` — default value when not provided
- `{only: Type1|Type2}` — restrict relation targets or enum options to a subset
- `{exclude: value1|value2}` — remove specific options
- `{when: field=value}` — conditional field, only relevant when condition is met
- `{min: N, max: N}` — numeric or count range
- `{value: X}` — fixed constant

### Types vs Tags

- **Type** — single-valued, provides identity, has associated fields and views
- **Tags** — multi-valued, hierarchical (e.g., `work/projects/binder`), used for cross-cutting categorisation

### Open Questions

- How strict should `{when}` validation be? Warn or error when conditional field present without condition met?
- Should the system auto-tag entities based on fields present, or keep type assignment explicit?
- Guidelines for when to use a type vs a tag

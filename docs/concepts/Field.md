---
status: active
description: A first-class, reusable schema element that defines what an entity can hold. Fields are themselves entities in the config namespace — schema as data. Unlike columns in relational databases, fields exist independently and can be shared across any number of types.
alternativeNames: [ attribute, property ]
tags: [ data-model ]
sourceFiles:
  - packages/db/src/model/field.ts
  - packages/db/src/model/ref.ts
  - packages/db/src/relationship-resolver.ts
relatesTo: [ __RaTedhj9s, 1jgIHtJoM1M, 3UzBoZGuDv0 ]
---

# Field

### Overview

A field is the fundamental schema primitive. It defines a named property with a data type, constraints, and optional metadata. In the RDF-inspired model, fields are **independent, reusable properties** — not columns owned by a table. A `status` or `description` field is defined once and composed into multiple types, enabling cross-type querying and consistent semantics.

Fields are themselves entities stored in the config namespace. This "schema as data" approach means fields can be queried, filtered, and managed just like any other entity.

### Field Definition

A field definition includes:
- **key** — unique identifier in the config namespace (e.g., `status`, `assignedTo`)
- **name** — human-readable display name
- **dataType** — the value format (see Data Type concept for full catalogue)
- **description** — what this field represents
- **allowMultiple** — whether the field accepts multiple values (array)

#### Data-type-specific properties

- **range** — for relation fields, which entity types are valid targets
- **options** — for option fields, the available choices
- **inverseOf** — for relation fields, the field on the target that auto-syncs (see Data Type concept for relation patterns)
- **attributes** — which field attributes can be attached to values (see Data Type concept for field attributes)

### Reusability

Because fields exist independently of types, the same field definition serves multiple purposes:
- A `status` field can appear on Task, Project, and Feature with different type-level constraints (defaults, allowed values)
- A `description` field works identically everywhere it's used
- Cross-type queries work naturally — "find everything with status=active" spans all types
- Adding a field to a new type requires no migration — just reference it in the type definition

### When to Create a New Field vs Reuse

Create a **new** field when the property has genuinely different semantics (e.g., `taskPriority` vs `bugSeverity`). **Reuse** an existing field when the meaning is the same across types, even if types constrain it differently (e.g., `status` with different allowed values per type).

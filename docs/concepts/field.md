---
key: field
name: Field
tags: [ data-model ]
status: active
description: A reusable schema element that defines what an entity can hold. Fields are themselves entities in the config namespace. Unlike columns in relational databases, fields exist independently and can be shared across any number of types.
alternativeNames: [ attribute, property ]
sourceFiles:
  - packages/repo/src/model/field.ts
  - packages/repo/src/model/ref.ts
  - packages/repo/src/relationship-resolver.ts
relatesTo:
  - data-type
  - reference
  - field-attribute
  - entity
  - vocabulary
  - entity-identity
  - type
---

# Field

## Details

### Overview

A field is the fundamental schema primitive. It defines a named property with a data type, constraints, and optional metadata. Fields are **independent, reusable properties**, not columns owned by a table. A `status` or `description` field is defined once and composed into multiple types, enabling cross-type queries and consistent meaning.

Fields are themselves entities stored in the config namespace, so they can be queried, filtered, and managed like any other entity. See Vocabulary concept for the "schema as data" approach.

### Field Definition

A field definition includes:
- **key**: unique identifier in the config namespace, e.g. `status`, `assignedTo`
- **name**: human-readable display name
- **dataType**: the value format . See Data Type concept
- **description**: what this field represents
- **allowMultiple**: whether the field accepts multiple values

#### Data-type-specific properties

- **range**: for relation fields, which entity types are valid targets
- **options**: for option fields, the available choices
- **inverseOf**: for relation fields, the field on the target that auto-syncs
- **attributes**: which field attributes can be attached to values

### Reusability

Because fields exist independently of types, the same field definition serves multiple purposes:
- A `status` field can appear on Task, Project, and Feature with different type-level constraints like defaults and allowed values
- A `description` field works identically everywhere it's used
- Cross-type queries work naturally: "find everything with status=active" spans all types
- Adding a field to a new type requires no migration, just reference it in the type definition

### Shared vs Type-Specific Fields

A shared field is a semantic contract, not merely a reused label. **Reuse** a field when it has the same meaning, data type, cardinality, and should be queried consistently across types. Types may still narrow its options, range, defaults, or requirements.

Create a **type-specific** field when the meaning or behaviour differs, even if the display name is similar. For example, `workStatus` and `paymentStatus` represent different concepts and should not share a generic `status` field.

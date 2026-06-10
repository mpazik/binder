---
key: vocabulary
name: Vocabulary
tags: [ data-model ]
status: active
description: The complete set of user-defined types, fields, and relations that give structure to repository data. Vocabulary is stored as entities in the config namespace and evolves dynamically through transactions without breaking existing records.
alternativeNames: [ schema ]
sourceFiles: [ packages/repo/src/model/schema.ts, packages/repo/src/schema.ts ]
relatesTo:
  - type
  - field
  - data-type
  - repository
  - extension
  - schema-configuration
  - autocompletion
  - diagnostics
  - code-actions
  - schema-preview
  - prob-schema-format
  - prob-role-of-types
  - prob-entity-recognition
  - prob-preset-key-conflicts
---

# Vocabulary

## Details

### Overview

Vocabulary is the user-defined schema that gives structure to repository data. It consists of field definitions, type definitions, and their relationships, all stored as entities in the config namespace. This "schema as data" approach means vocabulary can be queried, versioned, and evolved through the same transaction mechanism as any other data.

### Composition

A vocabulary comprises:
- **Fields**: reusable properties with data types and constraints like `status`, `assignedTo`, `dueDate`
- **Types**: entity classes that compose fields with contextual constraints like `Task`, `Project`, `User`
- **Relations**: connections between types via relation-typed fields with optional inverse definitions

### Dynamic Schema Evolution

Vocabulary evolves through transactions, following the same change tracking as all other data:
- Add new fields and types at any time without breaking existing records
- Entities don't need to conform strictly to their type, structure emerges gradually
- Complete audit trail of all schema changes via the transaction log
- Schema changes are atomic: a new type with its fields can be created in a single transaction

### Schema Format for LLM Context

A compact text format optimised for LLM comprehension and token efficiency. Uses 3-5x fewer tokens than JSON Schema for equivalent schemas.

#### Design Principles

- Uses patterns LLMs recognise from training: bullets, TypeScript syntax, HTML-style attributes
- Token-efficient to preserve context window space
- Colon syntax (`fieldName: Type`) familiar from TypeScript/YAML
- Constraint attributes like `{required}`, `{default: X}` are concise and composable

#### Structure

Three sections: SYSTEM FIELDS (available on all types), FIELDS (reusable properties), TYPES (entity classes composed of field references).

```
SYSTEM FIELDS (available on all types):
• id: number - Sequential identifier {readonly, computed}
• createdAt: datetime - Creation timestamp {readonly, computed}

FIELDS:
• fieldName: type - Description

TYPES:
• TypeName - Description [field1, field2{constraint}]
```

Single-line format for simple types and fields. Multi-line for types with more than 3 fields or complex constraints. Lowercase for fields and enums (`todo|done`), capitalised for entity types (`User|Team`).

#### Value Types

```
string, number, date, boolean           // Primitives (lowercase)
EntityType                              // Single relation (capitalised = in TYPES)
Type1|Type2                             // Union (single value, one of the types)
string[]                                // Array of primitives
EntityType[]                            // Array of relations
(Type1|Type2)[]                         // Array of union
option1|option2                         // Enum (lowercase values)
(option1|option2)[]                     // Multi-select enum
```

Type inference: lowercase = primitive or enum, capitalised = entity relation (must be in TYPES). `|` binds tighter than `[]`, so `(User|Team)[]` = array of (User or Team).

Relations are directional. Inverse relationships must be defined explicitly in both directions.

#### Constraints

```
{required, unique, readonly, computed, deprecated}  // Boolean flags
{value: X}                    // Fixed constant
{default: X}                  // Default value
{description: "text"}         // Type-specific description override
{min: N, max: N}              // Numeric/count range
{minLength: N, maxLength: N}  // String length
{pattern: "regex"}            // Validation pattern
{only: Type1|Type2}           // Restrict union/enum to subset
{exclude: value1|value2}      // Remove enum options
{when: field=value}           // Conditional: relevant only when met
```

Constraints compose: `title{required, minLength: 3, description: "Primary identifier"}`.

Conditional fields use `{when: field=value}`. A conditional `{required}` is only mandatory when the condition is satisfied. Used for fields that only make sense in certain contexts like `range{when: dataType=relation}`.

#### Complete Example

```
SYSTEM FIELDS (available on all types):
• id: number - Sequential identifier {readonly, computed}
• createdAt: datetime - Creation timestamp {readonly, computed}

FIELDS:
• title: string - Descriptive label
• description: text - Detailed description
• status: todo|in_progress|done|archived - Current state
• priority: low|medium|high - Importance level
• assignedTo: User|Team - Responsible party
• members: User[] - Team members
• tasks: Task[] - Related tasks
• tags: string[] - Category labels
• dueDate: date - When task is due

TYPES:
• Task - Individual unit of work [
    title{required},
    description,
    status{default: todo, exclude: archived},
    assignedTo{only: User},
    tags,
    dueDate,
    priority,
    completedAt{when: status=done},
  ]
• Project - Container for related tasks [
    title{required},
    description,
    status{required, default: todo},
    assignedTo,
    tags,
    tasks,
  ]
• User - Individual user account [name{required, description: "Full name"}]
• Team - Collaborative group [name{required}, members{min: 1}]
```

### Configuration

Users define and evolve vocabulary through agents with modelling skills, YAML config files, or the CLI. Schema changes go through the same transaction mechanism as data changes, so they are atomic, versioned, and reversible.

### Example Domains

A vocabulary can model any structured domain: project tracking, customer feedback, hiring pipelines, expense management, or LLM long-term memory. The same primitives: fields, types, and relations, adapt to each.

### Vocabulary Bank (Future)

A curated library of reusable field and type definitions that users can pick from before creating custom items. Items from the bank would carry provenance tracking back to the source for managed updates. The challenge is that fields tend to cluster, so ideally this would be a large, granular dependency tree users can cherry-pick from.

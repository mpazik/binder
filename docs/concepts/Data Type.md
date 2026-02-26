---
status: active
description: The value format assigned to a field — defines what values are valid, what operations apply, and how values are stored and indexed. Distinct from Field (which names a property) and Type (which classifies an entity).
alternativeNames: [ field type, value type, format ]
tags: [ data-model ]
sourceFiles: [ packages/db/src/model/data-type.ts, packages/db/src/data-type-validators.ts ]
relatesTo: [ 4zRN90q4XDM ]
---

# Data Type

### Overview

A data type defines the format and behaviour of a field's values. While a Field says _what_ an entity can have (e.g., "assignedTo"), the Data Type says _how_ that value behaves (e.g., "relation" — a typed link to another entity with inverse support).

### Core Data Types

#### Identifiers

- **seqId** — sequential integer ID for entities (internal use)
- **uid** — unique identifier (e.g., `tsk-abc123`)

#### Primitives

- **boolean** — true/false
- **integer** — whole numbers
- **decimal** — decimal numbers
- **string** — short text values
- **text** — single-line text with optional line breaks and inline formatting
- **date** — date only (no time)
- **datetime** — date with time

#### Structured

- **option** — single choice from predefined options
- **optionSet** — set of options to choose from
- **object** — complex object data

#### Specialised

- **uri** — reference to external resource; supports `uriPrefix` constraint for template-based URLs (e.g., GitHub issue links)
- **fileHash** — SHA-256 hash of a file
- **interval** — time period (timezone relative or specific)
- **duration** — length of time
- **image** — image URL or reference
- **formula** — computed expression evaluated from other fields (read-only)
- **condition** — filter conditions

Core data types are available in all namespaces. Record entities additionally support fileHash, interval, duration, uri, and image.

### Relation Data Type

The `relation` data type deserves special attention — it's what makes entities a graph rather than isolated records. A relation field stores a direct link to another entity, accessed as naturally as any other field — no join tables or explicit joins required.

#### Identifier strategy

- **Record namespace**: relations use UIDs (stable, conflict-free)
- **Config namespace**: relations use keys (human-readable for CLI and manual config)

#### Inverse relations

The `inverseOf` property enables automatic bidirectional sync in three patterns:

**One-to-Many (1:M)** — e.g., `children` (inverseOf: `parent`) ↔ `parent`
- Only the single-value side (`parent`) stores data; the multi-value side (`children`) is virtual
- Mutations on `children` are translated to `parent` changes on individual entities
- Avoids write amplification — a project with 200 tasks doesn't update an array on every task change

**One-to-One (1:1)** — e.g., `partner` (inverseOf: `partner`)
- Both sides store data
- Setting one side auto-updates the other; displacement is handled (old target's inverse is cleared)

**Many-to-Many (M:M)** — e.g., `relatedTo` (inverseOf: `relatedTo`)
- Both sides have `allowMultiple` and store data
- Insert/remove mutations are mirrored to the inverse field on the target entity

#### Filtered relations

Bracket syntax `Type[condition]` constrains relation targets at query time:
- Type provides indexability, condition filters results at runtime
- Simple conditions: `field=value`, `field!=value`, comma for AND
- Example: `assignedTo: User[active=true]`

### Field Attributes

Field attributes extend field values with structured metadata while keeping storage flat and predictable. The field value remains simple and indexable; attributes are stored in parallel using `fieldName.attrs`.

An **Attribute** is a config entity defining a single property (like `role`, `percentage`, `confidence`). Fields declare which attributes they support. Currently partially implemented for the `relation` data type, where relation-attributes are used in type definitions (e.g., `{required}`, `{only}`, `{exclude}`).

```yaml
key: assignedTo    # Field with attributes
dataType: relation
attributes: [role, percentage]

assignedTo:        # Usage

  - user-1: { role: lead, percentage: 60 }
  - user-2: { role: reviewer, percentage: 40 }
```

Common use cases: relationship metadata, dependency tracking, data provenance.

### Future: Data-Type Extensions

The `.attrs` pattern could be generalised to data-type-specific extensions using `fieldName.[extension-key]`:
- **relation**: `.hierarchy` for materialised paths in hierarchical queries
- **text/string**: `.embeddings` for vector search, `.stems` for full-text search

Extensions would be inherent to the data type's capabilities, maintaining flat storage while enabling type-appropriate optimisations.

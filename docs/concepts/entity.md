---
key: entity
name: Entity
tags: [ data-model ]
status: active
description: A flexible collection of field-value pairs with a layered identification strategy. Any entity can hold any field defined in the repository, regardless of its type.
alternativeNames: [ record, item, entry, card, object ]
sourceFiles:
  - packages/repo/src/model/entity.ts
  - packages/repo/src/model/record.ts
  - packages/repo/src/model/config.ts
  - packages/repo/src/utils/uid.ts
relatesTo:
  - field
  - type
  - reference
  - changeset
---

# Entity

## Details

### Overview

An entity is a collection of field-value pairs and the fundamental data unit in the repository. Unlike rows in a relational database, entities are not rigidly bound to a table schema. Any entity can have any field defined in the repository, so data can start loose and gain structure over time.

### Layered Identification

Offline-first sync requires stable identity that survives merges, but humans and LLMs need readable names, and storage needs compact integers. Rather than compromise, each entity has three identifiers optimised for different contexts:

#### UID (Canonical Public Identifier)

- Primary, immutable, globally unique identifier and the source of truth for identity
- Used in all public APIs and integrations
- **Rebase-safe**: value is permanent and never changes
- Example: `tsk-abc123`

#### Key (Human/AI-Friendly Identifier)

- Mutable, human-readable, token-efficient identifier
- Used for user-facing URLs like `/project-alpha` and LLM prompts
- Unique within a workspace but **not stable**, may change during rebase or title changes
- Can be auto-generated from title/name or set manually

#### Sequential ID (Internal Performance Identifier)

- Internal integer identifier for storage optimisation
- Used for all internal references, indexes, and the physical storage layer
- Enables compact binary encoding
- **Not stable**: recalculated during rebase, managed via per-layer pre-allocation

### System Fields

All entities have system-managed fields that are readonly and computed:
- `id`: sequential identifier
- `uid`: canonical unique identifier
- `key`: human-readable identifier
- `type`: entity's primary type
- `version`: change counter
- `createdAt`, `updatedAt`: timestamps
- `createdBy`, `updatedBy`: author references

### URL Resolution

The API uses a multi-tier lookup: first match UID format, then match known key. This allows stable links via UID and friendly URLs via key to coexist.

---
status: active
description: A flexible collection of field-value pairs with a layered identification strategy. Any entity can hold any field defined in the repository, regardless of its type.
alternativeNames: [ record, item, entry, card, object ]
tags: [ data-model ]
sourceFiles:
  - packages/db/src/model/entity.ts
  - packages/db/src/model/record.ts
  - packages/db/src/model/config.ts
  - packages/db/src/utils/uid.ts
relatesTo: [ 4zRN90q4XDM, 2J9ouH8xZek, -hfA_NVci3s ]
---

# Entity

### Overview

An entity is a collection of field-value pairs — the fundamental data unit in the repository. Unlike rows in a relational database, entities are not rigidly bound to a table schema. Any entity can have any field defined in the repository, enabling a gradually-structured approach where data can start loose and gain structure over time.

### Layered Identification

Every entity has three identifiers, each serving a distinct purpose:

#### UID (Canonical Public Identifier)

- Primary, immutable, globally unique identifier — the source of truth for identity
- Used in all public APIs and integrations
- **Rebase-safe** — value is permanent and never changes
- Format example: `tsk-abc123`

#### Key (Human/AI-Friendly Identifier)

- Mutable, human-readable, token-efficient identifier
- Used for user-facing URLs (e.g., `/project-alpha`) and LLM prompts
- Unique within a workspace but **not stable** — may change during rebase or title changes
- Can be auto-generated from title/name or set manually

#### Sequential ID (Internal Performance Identifier)

- Internal integer identifier for storage optimisation
- Used for all internal references, indexes, and the physical storage layer
- Enables varint encoding for compact binary format
- **Not stable** — recalculated during rebase; managed via per-layer pre-allocation

### System Fields

All entities have system-managed fields that are readonly and computed:
- `id` — sequential identifier
- `uid` — canonical unique identifier
- `key` — human-readable identifier
- `type` — entity's primary type (single-valued)
- `version` — change counter
- `createdAt`, `updatedAt` — timestamps
- `createdBy`, `updatedBy` — author references

### URL Resolution

The API uses a multi-tier lookup: first match UID format, then match known key. This allows both stable links (via UID) and friendly URLs (via key) to coexist.

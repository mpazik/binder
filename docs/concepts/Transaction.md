---
status: active
description: An atomic, immutable, content-addressable collection of entity changesets that forms the append-only change log of the repository. Like a Git commit for structured data.
alternativeNames: [ revision, checkpoint, commit ]
tags: [ change-tracking ]
sourceFiles:
  - packages/db/src/model/transaction.ts
  - packages/db/src/model/transaction-input.ts
  - packages/db/src/transaction-processor.ts
  - packages/db/src/transaction-store.ts
relatesTo: [ -hfA_NVci3s, 7RVmgYuEPQI ]
---

# Transaction

### Overview

A transaction is the atomic unit of change in the repository. It groups changesets for multiple entities across the record and config namespaces into a single commit that either fully succeeds or fully fails. Transactions form an append-only linked list — each transaction references its predecessor by hash, creating a complete, tamper-evident history.

### Structure

A transaction contains:
- **id** — sequential integer (internal, for ordering and performance)
- **hash** — content-addressable hash computed from canonical form (like a Git commit hash)
- **previous** — hash of the preceding transaction (forming the linked list)
- **records** — changesets for record namespace entities (keyed by UID)
- **configs** — changesets for config namespace entities (keyed by key)
- **author** — who made the change
- **createdAt** — when the change was made

### Hierarchical Change Model

Changes are structured in three levels:
1. **Value Change** — atomic change to a single field value (e.g., `["set", "New Title", "Old Title"]`)
2. **Changeset** — collection of value changes for one entity's fields (see Changeset concept)
3. **Transaction** — collection of changesets across multiple entities, applied atomically

### Content-Addressable Hashing

Each transaction is hashed from its canonical form — fields sorted by ID, entities sorted by ref, empty changesets removed. This provides:
- **Integrity verification** — any tampering is detectable
- **Deduplication** — identical changes produce the same hash
- **Linked history** — the `previous` field creates a hash chain, like Git's commit graph

### Three Forms

Transactions exist in three representations, each optimised for a different context:
1. **Input** — flexible, user/agent-facing format. Accepts various reference formats (UID, key, inline). Validated and normalised into internal form during processing.
2. **Internal** — the stored form. Uses sequential IDs for references, is versioned, and supports propagation across space lineage (children rebase into parents).
3. **External** — used for cross-space synchronisation. Normalised to use UIDs for references, making it portable across repositories.

### Processing Order

Config changesets are processed **before** record changesets within a transaction. This means a transaction can create a new field definition and use that field on record entities in the same atomic operation — the schema is updated before the data that depends on it.

### Transaction Operations

- **Apply** — execute a transaction against the current repository state, producing a new version
- **Inverse** — create a transaction that reverses all changes (every set becomes a clear and vice versa, list mutations are reversed). Enables undo.
- **Squash** — combine multiple consecutive transactions into a single transaction with the same net effect. Used to compact history.

Rebase is handled at the changeset level — see Changeset concept.

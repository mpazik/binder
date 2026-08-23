---
key: transaction
name: Transaction
tags: [ change-tracking ]
status: active
description: An atomic, immutable, content-addressable collection of entity changesets that forms the append-only change log of the repository. Like a Git commit for structured data.
alternativeNames: [ revision, checkpoint, commit ]
sourceFiles:
  - packages/repo/src/model/transaction.ts
  - packages/repo/src/model/transaction-input.ts
  - packages/repo/src/transaction-processor.ts
  - packages/repo/src/transaction-applier.ts
  - packages/repo/src/transaction-store.ts
relatesTo:
  - changeset
  - repository
  - entity-identity
  - transaction-segment
  - layer
  - inbox
  - workflow
---

# Transaction

## Details

### Overview

A transaction is the atomic unit of change in the repository. It groups changesets for multiple entities across the record and config namespaces into a single commit that either fully succeeds or fully fails. Transactions form an append-only linked list where each transaction references its predecessor by hash, creating a complete, tamper-evident history.

### Structure

A transaction contains:
- **id**: sequential integer, internal, for ordering and performance
- **hash**: content-addressable hash computed from canonical form, like a Git commit hash
- **previous**: hash of the preceding transaction, forming the linked list
- **records**: changesets for record namespace entities, keyed by UID
- **configs**: changesets for config namespace entities, keyed by key
- **author**: who made the change
- **createdAt**: when the change was made
- **tags**: string array for categorisation and filtering (e.g. `import-tasks`, `sync`)
- **message**: optional human-readable summary, like a Git commit message
- **source**: optional reference (uid or key) to the record that originated the change
- **channel**: optional origin identifier — `cli`, `lsp`, `mcp`, `agent`, or `engine`

All fields including tags, message, source, and channel are included in the canonical hash, making them immutable once committed.

### Hierarchical Change Model

Changes are structured in three levels:
1. **Value Change**: atomic change to a single field value, e.g. `["set", "New Title", "Old Title"]`
2. **Changeset**: collection of value changes for one entity's fields
3. **Transaction**: collection of changesets across multiple entities, applied atomically

### Content-Addressable Hashing

Each transaction is hashed from its canonical form with fields sorted by ID, entities sorted by ref, and empty changesets removed. This provides:
- **Integrity verification**: any tampering is detectable
- **Deduplication**: identical changes produce the same hash
- **Linked history**: the `previous` field creates a hash chain, like Git's commit graph

### Representations

Transactions have three forms: **input** (flexible, accepts UIDs/keys/inline for user and agent authoring), **internal** (stored form with sequential IDs), and **external** (UID-based, portable across repositories for sync).

### Processing Order

Config changesets are processed **before** record changesets. A single transaction can create a new field definition and immediately use that field on record entities. The schema updates before the data that depends on it.

### Transaction Operations

- **Apply**: execute a transaction against the current repository state, producing a new version
- **Inverse**: create a transaction that reverses all changes. Every set becomes a clear and vice versa, list mutations are reversed. Enables undo.
- **Squash**: combine multiple consecutive transactions into one with the same net effect. Tags are merged (union of all tags), and the newest transaction's message, source, and channel are kept. Used to compact history.

Rebase is handled at the changeset level. See Changeset concept.

---
key: repository
name: Repository
tags: [ data-model ]
status: active
description: The versioned collection of entities within a workspace, stored as an append-only sequence of immutable transactions. Combines Git-like change tracking with flexible, reusable fields shared across types and direct links between entities.
alternativeNames: [ knowledge graph, database, data store ]
sourceFiles:
  - packages/repo/src/db.ts
  - packages/repo/src/knowledge-graph.ts
  - packages/repo/src/entity-store.ts
  - packages/repo/src/transaction-store.ts
relatesTo:
  - entity
  - namespace
  - transaction
---

# Repository

## Details

### Why

Existing tools force a choice: databases give you structure but no history, Git gives you history but only for files. A repository combines both with conflict-free synchronisation. Multiple users and devices can work offline and merge changes without coordination, while keeping a complete audit trail of every change.

### Overview

A repository is the complete, versioned collection of entities within a workspace. Think of it as **Git for structured data**: an append-only sequence of immutable transactions that captures every change ever made. The schema is simplified and flexible. See Vocabulary concept. This makes it easy to evolve structure over time without migrations.

The system records every change and makes every past state recoverable. The schema itself lives as queryable data you can evolve over time. The current implementation runs on SQLite.

### Structure

A repository is partitioned into three isolated **namespaces**: record, config, and transaction. Each functions as a sub-database with its own schema and identifier strategy. See the Namespace concept for details.

### Key Properties

- **Immutability**: Changes create new versions via transactions; existing data is never modified in place.
- **Atomic transactions**: All changes in a transaction succeed or fail together. Related entity changes should be grouped into a single transaction.
- **Schema as data**: The vocabulary that structures data is itself stored as queryable entities. See Vocabulary concept.
- **Shared fields**: Fields are reusable across any number of types. See Field concept.
- **Direct relations**: Relations are stored as field values, not in join tables. See Data Type concept.
- **Flexible types**: Types guide and validate but don't lock down storage. See Type concept.
- **Conflict-free sync**: The append-only transaction log and content-addressable hashing enable offline-first collaboration with automatic conflict resolution. See Changeset concept.
- **Complete audit trail**: Every create, update, and delete is recorded with author and timestamp. Any change can be reversed.
- **Isolation**: Each repository maintains independent schema and data. Entity identifiers are unique within their repository.
- **Offline-first**: The transaction log enables conflict-resilient syncing across multiple users and devices working offline.

### Key Rules & Constraints

1. **Schema compliance**: fields must exist in schema before use
2. **Type safety**: field values must match their defined data types
3. **Reference integrity**: record references use UIDs, config references use immutable keys
4. **Atomic transactions**: all changes in a transaction succeed or fail together

---
status: active
description: The versioned collection of entities within a workspace, stored as an append-only sequence of immutable transactions. Combines Git-like change tracking with RDF-style semantic flexibility — schema as data, shared fields across types, and first-class relations without joins.
alternativeNames: [ knowledge graph, database, data store ]
tags: [ data-model ]
sourceFiles:
  - packages/db/src/db.ts
  - packages/db/src/knowledge-graph.ts
  - packages/db/src/entity-store.ts
  - packages/db/src/transaction-store.ts
relatesTo: [ 1jgIHtJoM1M, -P3_Pq40zqM, _4h9vjf75WA ]
---

# Repository

### Overview

A repository is the complete, versioned collection of entities within a workspace. It is essentially **Git for structured data** — an append-only sequence of immutable transactions that captures every change ever made. Combined with RDF-style semantic flexibility and built-in schema evolution, it enables complete audit trails and offline-first collaboration.

The design draws from Datomic's time-travel and schema-as-data concepts, adapted for offline-first, multi-user, multi-device environments. The current implementation is built on top of SQLite, which provides indexes for common query patterns.

### Structure

A repository is partitioned into three isolated **namespaces** (record, config, transaction), each functioning as a sub-database with its own schema and identifier strategy. See the Namespace concept for details.

### Key Properties

- **Immutability**: Changes create new versions via transactions; existing data is never modified in place.
- **Atomic transactions**: All changes in a transaction succeed or fail together. Related entity changes should be grouped into a single transaction.
- **Schema as data**: The vocabulary (fields, types, relations) that structures data is itself stored as queryable entities in the config namespace.
- **Semantic flexibility**: Unlike traditional relational models where columns belong to tables, fields are first-class, shared primitives that can be reused across any number of types — following the RDF approach where properties exist independently of classes. This means a `status` or `description` field is defined once and composed into multiple types, enabling cross-type querying and consistent semantics.
- **First-class relations**: Relations between entities are stored directly as field values, not in separate join tables. Related entities are accessed as naturally as any other field — no joins required.
- **Weak types**: Types provide an additional layer of configuration (which fields to show, defaults, constraints) but don't impact the underlying storage structure. An entity's type can change without migrating data, and any entity can hold any field regardless of its type.
- **Complete audit trail**: Every create, update, and delete is recorded with author and timestamp. Any change can be reversed through inverse operations.
- **Isolation**: Each repository maintains independent schema and data evolution. Entity identifiers are unique only within their repository.
- **Offline-first collaboration**: The transaction log enables conflict-resilient syncing across multiple users and devices working offline.

### Key Rules & Constraints

1. **Schema compliance** — fields must exist in schema before use
2. **Type safety** — field values must match their defined data types
3. **Reference integrity** — record references use UIDs, config references use immutable keys
4. **Atomic transactions** — all changes in a transaction succeed or fail together

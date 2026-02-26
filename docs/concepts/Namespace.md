---
status: active
description: An isolated partition within the repository functioning as a sub-database with its own schema, identifier strategy, and storage characteristics. Three namespaces — record, config, transaction — provide clear separation of concerns between user data, schema definitions, and change history.
alternativeNames: [ partition, sub-database ]
tags: [ data-model ]
sourceFiles: [ packages/db/src/model/namespace.ts ]
relatesTo: [ 7RVmgYuEPQI, 1jgIHtJoM1M ]
---

# Namespace

### Overview

Namespaces are isolated partitions within the repository that function like sub-databases with no direct inter-linking. Each namespace has its own schema, identifier strategy, and serves a specific purpose. This isolation maintains clear boundaries between user data, system metadata, and change history.

### The Three Namespaces

#### Record Namespace

- **Purpose**: stores all user-facing data and business objects
- **Contents**: user data entities (tasks, projects, people, etc.)
- **Schema**: dynamically evolving, user-defined — constrained by and interpreted through config namespace definitions
- **References**: use UIDs (stable, conflict-free; large number of records makes human-readable keys impractical)
- **Characteristics**: fully mutable, evolves through transactions

#### Config Namespace

- **Purpose**: defines the vocabulary and constraints for all data in the system
- **Contents**: field definitions, type definitions, views, navigation, inbox configuration, MCP clients
- **Schema**: built-in fields schema that establishes the meta-model
- **References**: use keys (human-readable, essential for CLI and manual configuration; small dataset)
- **Characteristics**: semi-mutable — evolves through schema migrations with strict versioning

#### Transaction Namespace

- **Purpose**: stores the complete transaction history and change tracking metadata
- **Contents**: transaction entities with field changesets for records and configs
- **Schema**: built-in, immutable transaction schema that cannot be modified
- **References**: built-in
- **Characteristics**: append-only, immutable — provides the foundation for audit trails and time-travel

### Isolation Benefits

- **Schema evolution** — field definitions evolve independently from the data they describe
- **Metadata protection** — transaction data remains isolated from user data modifications
- **Conceptual clarity** — clear separation of concerns between different entity types
- **Query optimisation** — enables specialised indexing and storage strategies per namespace
- **Security boundaries** — simplifies access control with natural permission boundaries

### Implementation Considerations

- **Cross-namespace references**: discouraged but technically possible for specific use cases (e.g., transaction history backlinks from entities)
- **Namespace-aware queries**: the API allows an optional namespace parameter
- **Transaction atomicity**: transactions maintain atomicity across namespace boundaries; the order of applying changes across namespaces is predefined

A 4-namespace split (separating Schema from Space Config) was considered and rejected — the added coordination complexity and cognitive overhead wasn't justified by the marginal clarity gain.

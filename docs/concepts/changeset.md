---
key: changeset
name: Changeset
tags: [ change-tracking ]
status: active
description: A collection of value changes for a single entity's fields within a transaction. Four core operations, apply, squash, inverse, and rebase, enable undo, history compaction, and conflict resolution.
alternativeNames: [ diff, entity change, field changeset ]
sourceFiles:
  - packages/repo/src/model/changeset.ts
  - packages/repo/src/model/changeset-input.ts
  - packages/repo/src/changeset-processor.ts
  - packages/repo/src/changeset-applier.ts
relatesTo:
  - transaction
  - entity
---

# Changeset

## Details

### Overview

A changeset maps field keys to value changes for one entity. It is the entity-level building block of a transaction. The changeset system defines four core operations that make changes composable, reversible, and conflict-resolvable, which is essential for offline-first collaboration.

Changesets are mostly internal plumbing. Users encounter them when importing data, inspecting transaction history, or resolving sync conflicts manually.

An entity can be fully reconstructed by applying its sequence of changesets: E₀ + D₁ = E₁, E₁ + D₂ = E₂, etc.

### Value Change Types

Each field change is a typed tuple describing the operation:

#### Set

`["set", newValue, previousValue?]` replaces the field's value. The optional `previous` enables conflict detection: if the current value doesn't match, the change is based on stale data. When `previous` is omitted, the field was previously empty.

#### Clear

`["clear", previousValue]` removes the field's value. Records what was there for reversibility.

#### Seq (Sequence Mutations)

`["seq", mutations[]]` is an ordered list of mutations for multi-value fields. Avoids replacing the entire array on every change. Three mutation types:
- **insert** `["insert", value, position?]`: add a value at a position or append
- **remove** `["remove", value, position?]`: remove a value at a position
- **patch** `["patch", ref, attrChangeset]`: modify attributes on a relation value without removing/re-adding it, e.g. change the `role` attribute on an `assignedTo` relation

#### Patch

`["patch", attrChangeset]` modifies attributes on a single-value relation field. Like seq's patch mutation but for non-array relations.

### Core Operations

Four operations make changesets composable:

#### Apply

Produces a new entity state from a previous state and a changeset:
`E(n) + D(n+1) = E(n+1)`

#### Inverse

Creates a changeset that reverses the original. `set` becomes the reverse `set` or `clear`, `clear` becomes `set`, list mutations are reversed in order. Satisfies: `D + D⁻¹ = D₀` (zero changeset).

#### Squash

Combines two changesets into one with the same net effect: `apply(E, squash(D₁, D₂)) = apply(apply(E, D₁), D₂)`. Cancels out complementary changes like insert then remove of the same value. Used for history compaction.

#### Rebase

Resolves conflicts when two changesets are based on the same entity state. If D₁ and D₁' both modify E(n), rebase transforms D₁' so it can be applied after D₁: `D₁'^rebase(D₁) = D₂`. For set/clear changes, rebase updates the `previous` value to match the post-D₁ state. For seq mutations, positional adjustments account for inserts/removes from the base changeset.

### Consistent Ordering

Before hashing, changesets are put into a consistent order: field changes are sorted by field ID, seq mutations sorted by position. This ensures identical logical changes always produce the same hash regardless of input ordering.

### Deletion as Full Field Retraction

Deleting an entity generates a changeset that clears every populated field. Scalar fields produce `["clear", previousValue]`, multi-value fields produce `["seq", [["remove", item], ...]]`. This captures the complete prior state, so inverse produces a changeset that recreates the entity with all its data — making undo work without special-casing deletion.

### Compact Notation

For ergonomic input (YAML, CLI), simple set changes can be written as plain values rather than explicit tuples — `title: "New Title"` instead of `title: ["set", "New Title"]`. The system normalizes these during processing.

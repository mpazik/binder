---
status: active
description: A collection of value changes for a single entity's fields within a transaction. Supports a formal algebra — apply, squash, inverse, rebase — enabling undo, history compaction, and conflict resolution.
alternativeNames: [ diff, entity change, field changeset ]
tags: [ change-tracking ]
sourceFiles:
  - packages/db/src/model/changeset.ts
  - packages/db/src/model/changeset-input.ts
  - packages/db/src/changeset-processor.ts
relatesTo: [ _4h9vjf75WA, 1jgIHtJoM1M ]
---

# Changeset

### Overview

A changeset maps field keys to value changes for one entity. It is the entity-level building block of a transaction. The changeset system defines a formal algebra that makes changes composable, reversible, and conflict-resolvable — properties essential for offline-first collaboration.

An entity can be fully reconstructed by applying its sequence of changesets: E₀ + D₁ = E₁, E₁ + D₂ = E₂, etc.

### Value Change Types

Each field change is a typed tuple describing the operation:

#### Set

`["set", newValue, previousValue?]` — replace the field's value. The optional `previous` enables conflict detection (if the current value doesn't match `previous`, the change is based on stale data). When `previous` is omitted, it means the field was previously empty.

#### Clear

`["clear", previousValue]` — remove the field's value. Records what was there for reversibility.

#### Seq (Sequence Mutations)

`["seq", mutations[]]` — ordered list of mutations for multi-value fields. Avoids replacing the entire array on every change. Three mutation types:
- **insert** `["insert", value, position?]` — add a value at a position (or append)
- **remove** `["remove", value, position?]` — remove a value at a position
- **patch** `["patch", ref, attrChangeset]` — modify attributes on a relation value without removing/re-adding it (e.g., change the `role` attribute on an `assignedTo` relation)

#### Patch

`["patch", attrChangeset]` — modify attributes on a single-value relation field. Like seq's patch mutation but for non-array relations.

### Changeset Algebra

Four operations form the algebra:

#### Apply

Produces a new entity state from a previous state and a changeset:
`E(n) + D(n+1) = E(n+1)`

#### Inverse

Creates a changeset that reverses the original — `set` becomes the reverse `set` (or `clear`), `clear` becomes `set`, list mutations are reversed in order. Satisfies: `D + D⁻¹ = D₀` (zero changeset).

#### Squash

Combines two changesets into one with the same net effect: `apply(E, squash(D₁, D₂)) = apply(apply(E, D₁), D₂)`. Cancels out complementary changes (e.g., insert then remove of the same value). Used for history compaction.

#### Rebase

Resolves conflicts when two changesets are based on the same entity state. If D₁ and D₁' both modify E(n), rebase transforms D₁' so it can be applied after D₁: `D₁'^rebase(D₁) = D₂`. For set/clear changes, rebase updates the `previous` value to match the post-D₁ state. For seq mutations, positional adjustments account for inserts/removes from the base changeset.

### Canonicalization

Before hashing, changesets are canonicalized: field changes are sorted by field ID, seq mutations sorted by position. This ensures identical logical changes always produce the same hash regardless of input ordering.

### Compact Notation

For ergonomic input (YAML, CLI), simple set changes can be written as plain values rather than explicit tuples — `title: "New Title"` instead of `title: ["set", "New Title"]`. The system normalizes these during processing.

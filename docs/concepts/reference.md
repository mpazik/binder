---
key: reference
name: Reference
tags: [ data-model ]
status: active
description: A direct link between entities stored as a field value. References use different identifier strategies per namespace and support automatic bidirectional sync via inverse relations.
alternativeNames: [ relation, link, entity link ]
sourceFiles:
  - packages/db/src/model/ref.ts
  - packages/db/src/relationship-resolver.ts
  - packages/db/src/filter-entities.ts
relatesTo:
  - field
  - data-type
  - entity
---

# Reference

## Details

### Overview

A reference is a direct link from one entity to another, stored as a field value on the `relation` data type. References are what make entities a graph rather than isolated records. No join tables or explicit foreign keys required — a relation field stores the target's identifier and the system resolves it on read.

### Identifier Strategy

Each namespace uses the identifier format best suited to its characteristics:
- **Record namespace**: references use UIDs like `tsk-abc123`. UIDs are stable, conflict-free, and work across sync boundaries. The large number of records makes human-readable keys impractical.
- **Config namespace**: references use keys like `status`, `Task`. Keys are human-readable, essential for CLI usage and manual configuration. The small dataset makes collisions manageable.

### Inverse Relations

The `inverseOf` property on a relation field enables automatic bidirectional sync. When one side is updated, the other side updates automatically.

#### One-to-Many

`children` (inverseOf `parent`) ↔ `parent`. Only the single-value side (`parent`) stores data; the multi-value side (`children`) is virtual, resolved at query time. Mutations on `children` are translated to `parent` changes on individual entities. This avoids write amplification: a project with 200 tasks doesn't update an array on every task change. The query cost is identical either way.

#### One-to-One

`partner` (inverseOf `partner`). Both sides store data. Setting field A on entity X to Y generates a set of field B on entity Y to X. The old target's inverse is cleared only if it still points back to X, which lets normal updates repair previously inconsistent data instead of failing on stale assumptions. Displacement is handled — if Y already pointed to Z, Z's declaring field is cleared so the final graph converges to a consistent 1:1 link.

#### Many-to-Many

`relatedTo` (inverseOf `relatedTo`). Both sides have `allowMultiple` and store data. Insert/remove mutations are mirrored to the inverse field on the target entity.

### Filtered Relations

Bracket syntax `Type[condition]` constrains relation targets at query time:
- Type provides indexability, condition filters at runtime
- Simple conditions: `field=value`, `field!=value`, comma for AND
- Example: `assignedTo: User[active=true]`

### Implementation

#### Storage

Fields are stored as JSON in a `fields` BLOB column in SQLite. Record references are UID strings, config references are key strings. Multi-value relation fields (`allowMultiple: true`) are stored as JSON arrays. Internally, references resolve to sequential IDs for efficient joins. UID and key columns are indexed for fast lookups.

#### Validation

The `inverseOf` property is validated when creating field definitions:
1. Target must be an existing relation field
2. A single-value field cannot reference an `allowMultiple` target — place `inverseOf` on the `allowMultiple` side instead
3. If the target also declares `inverseOf`, it must point back to this field

### Cleanup on Deletion

When an entity is deleted, all references pointing to it are cleaned up in the same transaction:
- **Inverse relation fields** (`inverseOf`): handled by the existing inverse expansion machinery, which processes the clear/remove changes on the deleted entity's own relation fields.
- **Non-inverse incoming references**: a separate pass scans for entities whose fields contain the deleted UID. Single-value relations are cleared; multi-value relations get remove mutations. Fields with `inverseOf` are skipped to avoid double-processing.

#### Query Resolution

Inverse relations are resolved in `resolveIncludes` (relationship-resolver.ts). When a field has `inverseOf`, the system builds a filter on the inverse field rather than collecting UIDs from the source:

```
{ [inverseFieldKey]: { op: "in", value: [sourceEntityUids] } }
```

For `allowMultiple` inverse fields, `buildFilterCondition` generates a `json_each` subquery to test array membership. For single-value fields, it generates a simple `IN` comparison. Results are matched back to source entities in `mergeRelationshipData`.

# References

## Introduction
This document describes how relationships between entities are modeled and stored in Binder. Relationships use the `relation` data type, with different identifier strategies per namespace.

**Identifier Strategy**: 
- **Record Namespace**: References use UIDs (stable, conflict-free, no human-readable keys needed)
- **Config Namespace**: References use keys (human-readable for CLI/manual configuration)

## Reference Types

### Within Namespace

**Record-to-Record Relations**
- Uses UID references (e.g., `"tsk-abc123"`)
- Rationale: UIDs are stable across changes; large number of records makes human-readable keys impractical
- Supports inverse relations via `inverseOf` property

**Config-to-Config Relations**  
- Uses key references (e.g., `"title"`, `"Task"`)
- Rationale: Small dataset, human readability essential for CLI and manual configuration
- Common for: domain/range constraints, type inheritance (`extends`), inverse relations

### External References

**URI Links**
- Field type: `uri`
- Links to external resources (e.g., `"https://github.com/owner/repo/issues/123"`)
- Optional `uriPrefix` constraint in field definition

### Future: Cross-Namespace & Cross-Database

**Cross-Namespace**
- Status: Not yet implemented
- Use case: Transaction history backlinks from entities

**Cross-Database**
- Status: Not yet implemented  
- Use cases: Federated systems, shared reference data, central user management

## Storage

Fields are stored as JSON in a `fields` BLOB column in SQLite. References are stored as strings:
- **Record references**: UID strings
- **Config references**: Key strings

Multi-value relation fields (`allowMultiple: true`) are stored as JSON arrays of strings.

Internally, references resolve to sequential IDs for efficient joins. UID and key columns are indexed for fast lookups.

## Inverse Relations

The `inverseOf` property on a relation field enables automatic bidirectional sync between two fields. When one side is updated, the other side is updated automatically.

### Relationship Patterns

**One-to-Many (1:M)** — e.g., `children` (inverseOf: "parent") ↔ `parent`
- The `allowMultiple` side declares `inverseOf`, the single-value side does not
- Only the single-value side (`parent`) stores data; the multi-value side (`children`) is virtual
- **Sync**: mutations on `children` (insert/remove) are translated to `parent` changes on individual child entities. The `children` field itself is stripped from the changeset — it is never written to the database
- **Query**: resolved via reverse lookup — finds entities whose `parent` field matches the source entity's UID

**One-to-One (1:1)** — e.g., `partner` (inverseOf: "partner")
- Both sides are single-value relation fields
- Can be symmetric (same field, e.g., `partner` inverseOf `partner`) or asymmetric (two different fields)
- Both sides store data
- **Sync**: setting field A on entity X to Y generates a set of field B on entity Y to X. Clearing or replacing also updates the old target. Displacement is handled — if Y already pointed to Z, Z's inverse is cleared
- **Query**: resolved via reverse lookup — finds entities whose inverse field equals the source entity's UID. Returns a single entity (not an array)

**Many-to-Many (M:M)** — e.g., `relatedTo` (inverseOf: "relatedTo")
- Both sides have `allowMultiple`
- Can be symmetric (same field) or asymmetric (two different fields, e.g., `linksTo` ↔ `linkedFrom`)
- Both sides store data
- **Sync**: insert/remove mutations are mirrored to the inverse field on the target entity. Both sides are kept in the changeset
- **Query**: resolved via reverse lookup — finds entities whose inverse field (a JSON array) contains the source entity's UID, using SQLite's `json_each` for array membership testing. Returns an array

### Why 1:M Uses a Virtual Inverse

For 1:M, only the "one" side stores data. The "many" side is computed at query time. This avoids write amplification: a project with 200 tasks would require updating the project's `children` array on every single task change. With the virtual approach, each task change writes only one field (`parent`) on one record. The query cost is identical either way — SQLite scans for matching `parent` values regardless.

For 1:1 and M:M, both sides store data because there is no natural asymmetry to exploit. Both sides have similar write costs, and neither side is a clear "source of truth".

### Validation Rules

The `inverseOf` property is validated when creating field definitions:

1. Target must be an existing relation field
2. A single-value field cannot reference an `allowMultiple` target (use the other direction — place `inverseOf` on the `allowMultiple` side)
3. If the target also declares `inverseOf`, it must point back to this field (mutual reference)

### Query Resolution

Inverse relations are resolved in `resolveIncludes` (relationship-resolver.ts). When a field has `inverseOf`, instead of collecting UIDs from the source entities and looking them up, it builds a filter on the inverse field:

```
{ [inverseFieldKey]: { op: "in", value: [sourceEntityUids] } }
```

For `allowMultiple` inverse fields, `buildFilterCondition` (filter-entities.ts) generates a `json_each` subquery to test array membership. For single-value fields, it generates a simple `IN` comparison.

Results are matched back to source entities in `mergeRelationshipData`, which checks whether each related entity's inverse field value contains the source entity's UID.

## Related Documentation
- [Entity Data Model](./entity-data-model.md) - Field types and constraints
- [Namespaces](./namespaces.md) - Namespace isolation model

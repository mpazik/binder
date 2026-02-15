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

Internally, references resolve to sequential IDs for efficient joins. UID and key columns are indexed for fast lookups.

## Related Documentation
- [Entity Data Model](./entity-data-model.md) - Field types and constraints
- [Namespaces](./namespaces.md) - Namespace isolation model

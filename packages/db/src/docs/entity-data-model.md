# RDF-Inspired Entity Data Model
An RDF-inspired entity data model that combines semantic flexibility with Git-like change tracking. Entities are collections of property-value pairs that evolve through immutable diffs, enabling complete audit trails and offline-first collaboration.

It is essentially Git for structured data with RDF-style semantic flexibility and built-in schema evolution. Or like taking Datomic's core time-travel and schema-as-data concepts and adapting them for offline-first, multi-user, multi-device environments.

## Core Concepts

**Schema** - The complete set of field definitions and entity types available in a database. Schema evolves dynamically through transactions but follows strict layering rules.

**Entity** - A collection of field-value pairs. Any entity can have any field defined in the database.

**Field** - First-class schema elements that define name, data type, and constraints. Fields are themselves entities in the database.

**Data Type** - Type definitions for field values: primitives (string, boolean, date), relations (links between entities), URIs (external references), and options (enumerations).

**Database** - Complete collection of entities represented as a sequence of transactions. Each database provides isolated multi-tenancy.

**Namespaces** - Three isolated namespaces that function like sub-databases with no direct inter-linking.
- **Transaction Namespace**: Contains transaction entities, uses built-in transaction schema
- **Config Namespace**: Contains field and type definitions, uses built-in fields schema. Config entities use immutable keys for references.
- **Record Namespace**: Contains user data entities, uses user-defined schema that evolves through config namespace transactions. Record entities use UIDs for references.

**Transaction** - Atomic collection of changesets modifying multiple entities simultaneously.

**Field Changeset** - Collection of value changes for a single entity's fields. Maps field keys to value changes.

**Change Algebra** - Mathematical operations on changes: apply (modify entity), squash (combine changes), inverse (revert changes), and rebase (conflict resolution).

## Key Features
- **Schema as Data**: Fields describing entities are themselves queryable entities
- **Multi Namespace Support**: Three isolated namespaces function as sub-databases with built-in schemas for transactions/fields and user-defined schemas for entities
- **Complete Audit Trail**: Every change preserved and reversible through change history
- **Semantic Flexibility**: RDF-style field constraints with dynamic schema evolution
- **Offline-First Collaboration**: Transaction logs enable conflict-resilient syncing across multiple users and devices working offline
- **Data Bridges**: Future support for cross-database synchronization to share partial information between isolated databases
- **Isolation**: Each database maintains independent schema and data evolution

## Hierarchical Diff Structure
The system uses a three-level hierarchy for changes:
- **Value Change** (atomic unit): Change to a single field value. Example: `{ op: "set", value: "New Title", previous: "Old Title" }`
- **Field Changeset** (entity-level): Maps field keys to value changes for one entity. Example: `{ title: { op: "set", value: "New Title" }, status: { op: "set", value: "active" } }`
- **Transaction** (atomic commit): Contains field changesets for multiple entities in `records` and `configs` properties. All changes apply atomically or not at all.


## User-Facing Terminology

End-user friendly terms for technical concepts:
**Database** → Space, Workspace, Database, Collection, Project
**Entity** → Record, Item, Entry, Card, Object
**Schema** → Vocabulary, Structure, Definition, Blueprint
**Field** → Field, Attribute, Property
**Transaction** → Revision, Checkpoint
**Value Change** → Change, Edit, Field Update
**Field Changeset** → Change Set, Update, Revision, Entity Change
**Reference** → Link, Connection, Reference, Relation, Association
**Data Type** → Field Type, Value Type, Format

## Key Rules & Constraints

1. **Schema Compliance**: Fields must exist in schema before use
2. **Type Safety**: Field values must match their defined data types
3. **Reference Integrity**: Record references use UIDs, config references use immutable keys
4. **Atomic Transactions**: All changes in a transaction succeed or fail together
5. **Immutability**: Changes create new versions, never modify existing data
6. **System Fields**: Entities have system-managed fields: `id`, `uid`, `key`, `type`, `version`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

## Data Types

### Core Data Types
- **seqId**: Sequential ID for entities (internal use)
- **uid**: Unique identifier (e.g., "tsk-abc123")
- **relation**: Link to another entity (records use UID, configs use key)
- **boolean**: true/false values
- **integer**: Whole numbers
- **decimal**: Decimal numbers
- **string**: Short text values
- **text**: Single-line text with optional line breaks and inline formatting
- **date**: Date only (no time)
- **datetime**: Date with time
- **option**: Single choice from predefined options
- **optionSet**: Set of options to choose from
- **object**: Complex object data
- **formula**: Formula expression
- **condition**: Filter conditions

### Record Data Types
In addition to core types, records can use:
- **fileHash**: SHA-256 hash of a file
- **interval**: Time period (timezone relative or specific)
- **duration**: Length of time
- **uri**: URI reference to external system
- **image**: Image URL or reference

## Best Practices

1. **Group Related Changes**: Include all related entity changes in one transaction
2. **Use References**: Link entities rather than duplicating data
3. **Validate Types**: Ensure field values match schema definitions
4. **Complete Changesets**: Include all necessary fields for entity consistency

## Error Handling

Common errors to handle:
- Unknown field (not in schema)
- Type mismatch (wrong data type for field)
- Invalid reference (referenced entity doesn't exist)
- Missing required fields
- Transaction conflicts (concurrent modifications)

This digest provides the essential information for creating transactions and querying entities. Always validate against the current schema and follow the type system for reliable operations.

# Namespaces

Namespaces are isolated partitions within the database that function like sub-databases with no direct inter-linking. Each namespace can have its own schema, including data types, and serves a specific purpose in the entity data model architecture. This isolation helps maintain clear boundaries between system metadata, schema definitions, and user data.

## Core Namespaces

The system uses three primary namespaces, each with distinct responsibilities:

### Record Namespace
- **Purpose**: Stores all user-facing data and business objects
- **Contents**: User data entities with record-specific fields
- **Schema**: Uses dynamically evolving, user-defined schema that references the Config Namespace
- **Characteristics**: Fully mutable, evolves through transactions that modify the Config Namespace
- **Data Flow**: Data here is constrained by and interpreted through the Config Namespace definitions

### Config Namespace
- **Purpose**: Defines the vocabulary and constraints for all data in the system
- **Contents**: Field definitions, data type definitions, validation rules, entity type definitions, views, inbox configuration, mcp clients
- **Schema**: Uses a built-in fields schema that establishes the meta-model
- **Characteristics**: Semi-mutable - can evolve through schema migrations but follows strict versioning rules
- **Data Flow**: Changes here directly affect what can be stored in the Record Namespace


### Transaction Namespace
- **Purpose**: Stores the complete transaction history and change tracking metadata
- **Contents**: Transaction entities with field changesets for records and configs
- **Schema**: Uses a built-in, immutable transaction schema that cannot be modified
- **Characteristics**: Append-only, immutable history that provides the foundation for audit trails and time-travel capabilities
- **Data Flow**: All modifications to other namespaces are recorded here first

## Namespace Isolation Benefits

- **Schema Evolution**: Allows field definitions to evolve independently from the data they describe
- **Metadata Protection**: System transaction data remains isolated from user data modifications
- **Conceptual Clarity**: Clear separation of concerns between different types of entities
- **Query Optimization**: Enables specialized indexing and storage strategies for each namespace
- **Security Boundaries**: Simplifies access control by creating natural permission boundaries

## Implementation Considerations

- **Cross-Namespace References**: While direct linking between namespaces is discouraged, it will be technically possible using [cross namespace references](references.md#cross-namespaces)
    - Use cases:
        - Referencing update history (transactions) for a given entity. It would require backlinks from entity to transactions
- **Namespace-Aware Queries**: The API for querying entities would need to allow for optional namespace parameter
- **Transaction Atomicity**: Even though namespaces are isolated, transactions should maintain atomicity across namespace boundaries when necessary. The order of applying transactions across namespaces will be predefined.
- **Namespace Identifiers**: Each namespace needs a distinct, single-word identifier that clearly conveys its use case and has an intuitive meaning on its own (e.g., `transaction`).
    - **Final Names**: `record`, `config`, `transaction`.
    - **Names Considered**:
        - For `record` (user data): `node`, `objects`, `data`, `entities`(too generic), `user`(might be misleading), `content`(too close to config), `domain`, `realm`, `workspace` (not meaningful on its own),
        - For `config` (configuration/schema): `attributes`, `schema`, `meta`, `definition`, `settings`, `structure`, `blueprint`.

## Other considerations

### Separate Schema Namespace Option

An alternative architecture would split the Config namespace into two separate namespaces:

**4-Namespace Architecture:**
- **Record** - User's actual data (Person Mike)
- **Schema** - Structure definitions (Person type, fields, data types)
- **Space Config** - System behavior (LLM instructions, views, inboxes, assistants)
- **Transaction** - Audit log of all changes

**Pros:**
- **Crystal clear mental model** - No confusion about what belongs where
- **Risk isolation** - Schema changes (high risk) separated from config changes (low risk)

**Cons:**
- **Cross-namespace coordination** - Creating a new entity type requires updates to both Schema (structure) and Config (default views)
- **More complex transactions** - Need to ensure atomicity across 4 namespaces instead of 3
- **Cognitive overhead** - Users and Developers must understand one more namespaces instead of 3
- **Similar performance characteristic** - Seem that there would be lot's of duplication between these two namespaces

For the sake of simplicity, especially of the end user I decided against that option.

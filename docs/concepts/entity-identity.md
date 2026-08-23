---
key: entity-identity
name: Entity Identity
tags: [ data-model ]
status: active
description: The namespace-agnostic identity model that separates permanent entity identity, useful symbolic keys, and compact materialization identifiers.
alternativeNames: [ identifier, entity identifier, identification ]
sourceFiles:
  - packages/repo/src/model/entity.ts
  - packages/repo/src/model/ref.ts
  - packages/repo/src/utils/uid.ts
  - packages/repo/src/changeset-processor.ts
relatesTo:
  - layer
  - transaction-segment
  - entity
  - field
  - namespace
  - transaction
  - changeset
  - reference
---

# Entity Identity

## Details

### Overview

Every entity uses the same identity model regardless of namespace. The model separates three concerns:
- **UID** provides permanent identity across transactions, rebases, layers, and materializations.
- **Key** provides a readable and token-efficient symbolic identifier for humans, agents, APIs, queries, and transaction JSON.
- **Sequential ID** provides a compact integer for a particular materialization.

These identifiers are related, but they do not have the same stability guarantees. A key or sequential ID must never be treated as the permanent identity of an entity.

### UID

A UID is the source of truth for entity identity.
- It is assigned when the entity is first created.
- It is globally unique and never reused.
- It is preserved by rebase, including when other creation values are rewritten.
- It identifies the same entity across layer movement, transaction replacement, snapshots, imports, and materialization rebuilds.
- It is the only entity property with an absolute immutability guarantee.

`UID` describes the semantic role. Binder represents it using a compact, URI-compatible format rather than standard UUID text.

#### UID format

New UIDs use:
- 16 cryptographically random bytes;
- 22 characters of unpadded base64url encoding;
- a leading digit or `_` so a bare UID is lexically distinct from a key;
- uniform rejection sampling when constraining the first character.

For example:

```text
9wnPl9nzYjlqdnuYSwAmxg
```

No prefix is required. A leading `-` is excluded because it is awkward in CLI arguments. The exact UID shape is reserved and cannot be used as a key.

Existing shorter UIDs remain valid, but generators produce only the 16-byte form. A UID is never rewritten merely to adopt a newer representation.

### Key

A key is a useful symbolic identifier such as `status`, `assignedTo`, or `project-alpha`.

Keys are intentionally suitable for:
- field names in entity and transaction JSON;
- config references;
- queries and filters;
- CLI and API input;
- agent and LLM context;
- human-readable diagnostics.

A key is unique within its defined scope in an approved chain. Keys are resolved to UIDs when identity continuity matters. Alternative names and redirects are aliases, not replacements for the entity UID.

### Sequential ID

A sequential ID is an internal integer assigned by a materialization.
- It supports compact storage, indexes, joins, and binary encoding.
- It may be used as an efficient runtime reference.
- It may differ between clients, snapshots, or materialization rebuilds.
- It may be reassigned without changing logical state or transaction identity.
- It is not a portable reference and is not identity across rebase.

A materialized implementation may maintain indexes equivalent to:

```text
key   → { uid, sequentialId }
uid   → { key, sequentialId }
sequentialId → entity
```

This is one logical relationship, not a requirement to perform multiple physical lookups.

### Immutability scopes

#### UID immutability

UID immutability is absolute. Rebase may produce a new transaction and a new version of an entity's creation, but it must preserve the entity UID.

#### In-chain immutability

In-chain immutability applies within an approved transaction chain. An approved chain is the transaction chain selected by a layer head as its current accepted history.

For config entities:
- `key` is mandatory and cannot be changed by a later transaction in that chain;
- a field definition's `dataType` cannot be changed by a later transaction in that chain;
- a retired or deprecated config key remains reserved and cannot identify a different config entity.

Changing a config entity's meaning or a field's datatype requires creating a new config entity and explicitly migrating or replacing its uses.

#### Rebase mutability

Rebase does not mutate an existing transaction. It creates replacement transactions on a new predecessor while retaining the original transaction as immutable provenance.

A replacement of the transaction that created an entity may carry rewritten creation values. For example, deterministic collision resolution may suffix a config key:

```text
original creation: UID F1, key status
rebased creation:  UID F1, key status_2
```

Subsequent transactions in the rebased chain are rewritten to reference `status_2`. The UID establishes that both creation versions describe the same entity lineage.

Rebase should preserve a field's `dataType`. A conflict rule must not silently reinterpret existing values as another datatype. If a compatible rebased creation cannot be produced, the competing creation must yield, receive a distinct key, or be handled by explicit higher-level policy.

The distinction is therefore:
- an ordinary transaction cannot update an in-chain immutable value;
- rebase may replace the transaction that originally established that value;
- only the UID must remain identical across the replacement.

### Keys in transaction JSON

Transactions may use config keys and field keys directly. This keeps the protocol representation readable and token-efficient.

A key in a transaction is interpreted against the state identified by that transaction's predecessor. Config changes apply before record changes, so one transaction may create a config entity and then use its key.

During transaction processing and rebase, Binder follows this conceptual path:

```text
source key
→ resolve to UID in the source predecessor state
→ preserve identity by UID during transformation
→ resolve UID to the key in the destination state
→ emit the destination key in the rebased transaction
```

Because rebase changes the predecessor and may change emitted keys, it produces a new canonical transaction and transaction hash.

When upper layers are rebased after a lower-layer update, the rebased predecessor supplies the new config context. No separate config-base reference is needed when transaction ancestry identifies the complete state against which each transaction applies.

### Config-key collisions

Concurrent config creations may propose the same key while carrying different UIDs:

```text
branch A: status → UID F1
branch B: status → UID F2
```

Conflict resolution keeps the already-approved key and gives the incoming rebased creation a numeric suffix:

```text
status   → UID F1
status_2 → UID F2
```

The unsuffixed key is treated as the first occurrence, so generated suffixes start at `_2`. Binder chooses the lowest available positive suffix and preserves a previously generated suffix when it remains available. For example, if `status` and `status_2` are occupied, the next creation becomes `status_3`.

This rule is deterministic because the transaction predecessor and accepted transaction order determine which keys are occupied. Rebase rewrites later references from the losing proposal through its UID to the suffixed destination key.

A suffix resolves a creation collision. It is not an ordinary mutation of an already-created config entity on the approved chain. The UID remains internal and does not need to appear in the user-facing key.

### Identifier use

The identity model is namespace-agnostic. Different representations may favor different identifiers without changing that model:
- portable or continuity-sensitive operations use UIDs;
- readable config and field references use keys;
- materialized storage uses sequential IDs;
- user input may accept any unambiguous supported reference and resolve it before application.

Canonical snapshots and transaction history must preserve enough UID and key information to rebuild their logical identity mappings. Physical snapshots and databases may encode those mappings using arbitrary local sequential IDs.

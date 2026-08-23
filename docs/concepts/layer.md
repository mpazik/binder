---
key: layer
name: Layer
tags: [ data-model, change-tracking ]
status: active
description: A user-facing, ordered contribution to repository state backed by a transaction segment and resolved with other layers through field-level shadowing.
alternativeNames: [ data layer, overlay, semantic layer, database layer ]
relatesTo:
  - transaction
  - transaction-segment
  - changeset
  - entity
  - entity-identity
  - repository
  - query
---

# Layer

## Details

### Overview

A layer is a user-facing contribution to repository state backed by a [Transaction Segment](transaction-segment.md). Layers support foundational configuration, organization and workspace data, restricted data, personal data, and device-local data through one history and query model.

Layers are ordered. Each layer contributes sparse state above exactly one lower layer. A perspective selects a linear stack of layers, and the query resolver shadows lower contributions with higher contributions field by field.

Branches, local tails, and physical checkpoints reuse transaction-segment and segment-state machinery, but they are not all Layers as product concepts.

### Layer structure

A layer has:
- a permanent UID and useful key;
- one immediate lower layer, except for the root;
- a base head selected from the lower layer;
- one or more branch refs selecting layer heads;
- provenance describing its origin;
- distribution, encryption, and write policy;
- optionally, a publication or promotion target.

For a selected branch, the layer's current contribution is the transaction segment:

```text
(lower base head, selected layer head]
```

Folding that segment produces its segment state.

A layer may be empty. Its selected head then equals its lower base head, and its segment state contributes nothing.

### Layer identity and versions

A layer's UID identifies the same semantic layer across rebase and branch movement. Its exact state is identified by its selected base and head.

For example:

```text
personal layer UID: L1
old version: base S2, head P2
new version: base S3, head P2′
```

The layer remains the personal layer, while the new version selects a replacement transaction segment. Neither the old transactions nor the old segment are mutated.

A named ref selects the current head for a branch. Advancing the ref changes the selected layer version without changing layer identity.

### Layer stacks

A layer stack is linear from lowest to highest precedence:

```text
foundation
→ organization
→ workspace
→ restricted
→ personal
```

Every non-root layer has exactly one immediate lower layer. Combining multiple parents directly is not part of the Layer model. Reusable configuration is installed or rebased into a linear stack.

Each layer boundary divides one selected transaction chain into segments:

```text
G → F1 → F2 → O1 → W1 → W2 → P1
    foundation  org    workspace  personal
```

The complete chain supplies transaction and config ancestry. The semantic layer metadata records where each contribution begins, which branch is selected, and which policies apply.

### Perspective

A **perspective** is a selected layer stack, including the branch or head selected for every layer and an optional local tail.

Examples:

```text
employee perspective:
foundation → organization → workspace → personal

manager perspective:
foundation → organization → workspace → restricted → personal
```

A perspective determines which segment states participate in resolution. The resolved state is the result, not the perspective itself.

```text
perspective
→ selected transaction segments
→ segment states
→ field-level resolution
→ resolved state
```

### Sparse contributions and field-level shadowing

A layer stores only the entities and fields contributed by its segment.

```text
shared segment state:
  title  = Research Datomic
  status = active

personal segment state:
  status      = done
  privateNote = Compare entity specs

resolved state:
  title       = Research Datomic
  status      = done
  privateNote = Compare entity specs
```

Higher layers shadow lower layers field by field. An override of `status` does not hide an inherited `title`.

The model distinguishes three cases:
1. **Absent contribution:** this layer has no opinion, so the lower value is visible.
2. **Value contribution:** this layer supplies the visible value.
3. **Tombstone contribution:** this layer explicitly hides the lower value.

Removing an upper value contribution reveals the current lower value. Hiding the lower value requires an explicit tombstone. The transaction operation names and encoding for these two actions belong to the Changeset specification.

An entity tombstone similarly hides an entity supplied by a lower layer without deleting it from that lower layer.

### Transactions and config context

A transaction contributed by an upper layer follows the selected lower head or an earlier transaction in the same layer segment:

```text
shared S1 → personal P1 → personal P2
```

Its predecessor ancestry therefore identifies the complete state and config context against which it applies. No separate config-base reference is needed.

Transactions may use readable config and field keys. During processing and rebase, Binder resolves those keys to config UIDs through source ancestry, preserves identity by UID, and emits the key selected by destination ancestry.

### Cascading rebase

When a lower layer advances, every dependent upper segment is rebased in stack order.

Before:

```text
S1 → P1 → P2 → L1
```

After shared state advances to `S2`:

```text
S1 → S2 → P1′ → P2′ → L1′
```

The process is:
1. Rebase the first upper layer segment onto the new lower head.
2. Recompute its segment state and resulting head.
3. Rebase the next upper layer onto that head.
4. Continue through the selected stack and local tail.
5. Validate the complete resulting perspective.
6. Atomically select the replacement heads.

The old transactions remain immutable provenance. Replacement transactions receive new predecessor links and hashes. Entity and config UIDs remain stable. Config creation-key collisions are resolved according to the deterministic suffix rule defined by Entity Identity.

A lower-layer change to a shadowed field does not remove the higher contribution. For example:

```text
shared:   status = active
personal: status = done
```

If shared changes `status` to `archived`, the rebased personal segment still contributes `done`, so the personal perspective continues to resolve `done`. Removing the personal contribution later reveals `archived`.

Even when changesets are disjoint and remain byte-for-byte equivalent, their transaction envelopes and hashes change because their predecessors change.

### Layer roles

The same Layer concept supports several policies:

| Role         | Typical contribution                              | Distribution                      |
| ------------ | ------------------------------------------------- | --------------------------------- |
| foundational | core or reusable vocabulary and defaults          | broad, usually read-only          |
| organization | shared standards and configuration                | organization members              |
| workspace    | collaborative records and vocabulary              | workspace collaborators           |
| restricted   | sensitive records or fields                       | selected recipients               |
| personal     | private annotations, overrides, and configuration | one user, optionally synchronized |
| device-local | local-only values and experiments                 | one device                        |

These are policy roles, not distinct transaction formats.

Receiving an upper layer normally requires the lower ancestry needed to validate and materialize it. Per-layer encryption and distribution may enforce this dependency while preventing users without an upper-layer key from observing its contribution.

### Branches

A branch is an alternative named ref for one layer:

```text
workspace/main       → W5
workspace/experiment → E3
```

Both heads share the layer's semantic identity and lower base but select alternative transaction segments and segment states. Selecting a branch changes the perspective; it does not add another shadowing layer.

When a lower layer advances, selected branches are rebased immediately. Other branches may be rebased eagerly or when next selected, provided their old base remains identifiable and the resulting behavior is deterministic.

### Local tails and publication

A local tail is an unpublished transaction segment above a selected layer head:

```text
published head W5 → local L1 → local L2
```

Its segment state is placed above the selected layer stack for optimistic local queries.

Publication:
1. Pulls the target layer's current head.
2. Rebases the local segment when that head has advanced.
3. Optionally squashes transactions under the applicable history policy.
4. Advances the target layer ref to the resulting head.
5. Clears or advances the local-tail ref.
6. Rebases any higher dependent layers or tails.

A device-local Layer differs from a local tail: it is a durable semantic contribution with no publication target, while a local tail is pending work intended for another layer.

### Segment state, squash, and checkpointing

A layer's segment may be folded into segment state for queries without changing history.

A squash creates a shorter replacement transaction segment with the same required state effect. It changes transaction hashes and may reduce transaction-level fidelity. Segment state alone may be insufficient to construct a faithful squash because it need not retain operation semantics, inverse information, attribution, or transaction boundaries.

A checkpoint stores materialized state anchored to a head without changing the layer's transaction history. Pruning history behind a checkpoint is a separate retention operation and must state which undo, attribution, provenance, and historical-query guarantees are lost.

Physical compaction of query artifacts is not a semantic Layer and does not gain stack precedence.

### Materialization and queries

An implementation may materialize each selected segment state and maintain a disposable resolved projection for common queries. Sequential entity and config IDs are local to that materialization and may be reassigned without changing a layer, transaction, segment, or perspective.

Normal queries read resolved state. Provenance-aware queries may additionally report the layer and transaction that supplied each visible value. Queries may also inspect shadowed contributions when explicitly requested.

### Invariants

1. A Layer has one immediate lower Layer except at the root.
2. A selected Layer branch is backed by one contiguous transaction segment.
3. The segment base is the selected lower-layer head.
4. A perspective is a linear ordered stack.
5. Higher segment states shadow lower segment states field by field.
6. Absence and an explicit tombstone have different meanings.
7. Lower-layer advancement rebases dependent upper segments before the replacement perspective is selected.
8. Rebase creates replacement transactions and never mutates source transactions.
9. Layer identity and entity UIDs survive segment replacement.
10. Folding and checkpointing do not change transaction identity.

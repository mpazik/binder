---
name: binder-modeling
description: Binder data modeling — define entity types, fields, relations, constraints, views, and navigation. Use when asked to "create a type", "add a field", "define a schema", "set up relations", "model entities", "create a view", "set up navigation", "render entities as files", or design a binder workspace schema.
---

# Binder Data Modeling

Schema is stored as data — types and fields are config entities that evolve through transactions.

## Core Concepts

- **Field** — first-class schema element (name, data type, constraints). Shared across types (RDF-style)
- **Type** — organizes entities and applies field constraints. Any entity can have any field
- **Transaction** — atomic changes to multiple entities. Schema changes use `binder tx import`

## Namespaces

- **Record** — user data. References use UIDs
- **Config** — schema (Fields, Types, Attributes). References use immutable keys
- **Transaction** — append-only audit log

## Defining Fields

Fields exist independently of types. Define in a transaction YAML and import with `binder tx import`:

```yaml
- author: system
  configs:
    - key: priority
      type: Field
      name: Priority
      dataType: option
      options: [low, medium, high]
      default: medium

    - key: assignee
      type: Field
      name: Assignee
      dataType: relation
      range: [User]
```

## Defining Types

Types compose fields with optional per-type constraints:

```yaml
- author: system
  configs:
    - key: Task
      type: Type
      name: Task
      fields:
        - title: { required: true }
        - status: { default: active, only: [draft, active, complete] }
        - priority
        - parent: { only: [Task] }
        - children: { only: [Task] }
```

Constraints: `required`, `default`, `only: [...]`, `exclude: [...]`.

## Relations

Use `inverseOf` for bidirectional sync. See [references/relations.md](references/relations.md) for patterns and storage details.

**1:M** — `allowMultiple` side declares `inverseOf`, single-value side stores data:
```yaml
    - key: parent
      type: Field
      dataType: relation
    - key: children
      type: Field
      dataType: relation
      allowMultiple: true
      inverseOf: parent
```

**M:M** — both sides `allowMultiple`, both store data:
```yaml
    - key: relatesTo
      type: Field
      dataType: relation
      allowMultiple: true
      inverseOf: relatesTo
```

## Attributes

Attach metadata to field values (e.g. `role` on an `assignedTo` relation). An attribute is just a regular `Field` that another field references via its `attributes` list. See [references/field-attributes.md](references/field-attributes.md) for full details.

```yaml
- author: system
  configs:
    - key: role
      type: Field
      dataType: plaintext

    - key: assignedTo
      type: Field
      dataType: relation
      range: [User]
      attributes: [role]
```

> Note: `docs/concepts/field-attribute.md` shows `type: Attribute` in examples — that form is rejected by the runtime. Use `type: Field` for the attribute definition itself.

## Rendering: Views and Navigation

A schema describes data shape. Two more config entity types — `View` and `Navigation` — describe how that data is rendered as files and edited back into entities. They live in the same config namespace as `Field` and `Type` and are imported the same way (`binder tx import`).

- **View** — markdown template with `{fieldName}` slots. Renders an entity to markdown; edits to the rendered file extract back into a transaction
- **Navigation** — maps a query to a file path and a view, producing the workspace's file tree

Minimal view:

```yaml
- author: system
  configs:
    - key: task-view
      type: View
      preamble: [key, status, priority, parent]
      viewContent: |
        # {title}

        {description}

        ## Details
        {details}
```

Minimal navigation wiring that view to a file path:

```yaml
- author: system
  configs:
    - key: nav-tasks
      type: Navigation
      path: tasks/{key}
      where: { type: Task }
      view: task-view
```

Result: every `Task` entity renders to `tasks/{key}.md` using `task-view`. Editing the file syncs changes back to the entity.

Key points to know when modeling:

- Path placeholders are single-segment only (cannot contain `/`); fan-out happens automatically on `allowMultiple` path fields
- Path without a `view` produces a YAML file; path ending with `/` produces a directory for children
- Items with a `where` clause support **create-by-file**: dropping a new file at a matching path creates the entity
- When a sub-view renders new relation children, the type must be resolvable: render a `{type}` slot, narrow the field's `range` to one type, or set `only: SingleType` on the parent type's field

See [references/views.md](references/views.md) for slot syntax, expression props (`view:`, `where:`, flags), formats, and bidirectional sync. See [references/navigation.md](references/navigation.md) for path interpolation, fan-out, nested children, and the rendering pipeline.

## Data Types

Canonical list comes from `binder schema -n config` — inspect the `dataType` field's `options` to confirm in your build.

- **Text** — `plaintext`, `richtext`
- **Numbers** — `boolean`, `integer`, `decimal`
- **Time** — `date`, `datetime`, `period`, `interval`, `duration`
- **References** — `relation`, `uri`, `fileHash`, `image`
- **Enumeration** — `option` (single value, or multi-value with `allowMultiple: true`)
- **Query** — `query` (stored query definition)
- **System (auto-managed, do not define manually)** — `seqId`, `uid`

### Common pitfalls

- **`text` and `string` are not valid.** Use `plaintext` (unformatted) or `richtext` (markdown). Pair with a format constraint (see below) for tighter validation.
- **`optionSet` is internal.** Used by binder's built-in `options` config field. For user-facing multi-select enums, use `dataType: option` with `allowMultiple: true`:
  ```yaml
  - key: qualityChecks
    type: Field
    dataType: option
    allowMultiple: true
    options: [data, experience, question, angle, extension]
  ```
- **`json`, `object`** are used by built-in config fields but generally not needed for user data; prefer structured fields or relations.

### Format Constraints

`plaintext`, `richtext`, and `period` accept format hints that restrict structure. The tighter the format, the more places a field can be reused in views and sync. See [docs/concepts/text-format.md](../../docs/concepts/text-format.md) for the full rationale and per-format validation rules.

- `plaintextFormat`: `identifier` | `word` | `phrase` | `line` | `paragraph` | `uri` | `filepath` | `semver`
- `richtextFormat`: `word` | `phrase` | `line` | `block` | `section` | `document`
  - `section` requires `sectionDepth` (1–5) to anchor heading levels (`sectionDepth: 2` means content lives under an `##` heading; only `###` and deeper allowed inside).
- `periodFormat`: `day` (`YYYY-MM-DD`) | `week` (`YYYY-W##`) | `month` (`YYYY-MM`) | `quarter` (`YYYY-Q#`) | `year` (`YYYY`). Required on `period` fields.

Multi-value delimiter (when `allowMultiple: true`) follows the format:
- comma: `identifier`, `word`, `phrase`, `semver`
- newline: `line`, `uri`, `filepath`
- blank line: `paragraph`, `block`
- header at sectionDepth+1: `section`
- horizontal rule (`---`): `document`

Example:

```yaml
- key: handle
  type: Field
  dataType: plaintext
  plaintextFormat: identifier

- key: bio
  type: Field
  dataType: richtext
  richtextFormat: block

- key: dayPeriod
  type: Field
  dataType: period
  periodFormat: day
```

## Field Properties

Full list of properties accepted on a `Field` config entity:

| Property | Purpose |
|---|---|
| `key`, `name`, `description` | Identity and labelling |
| `dataType` | Required. See Data Types above |
| `allowMultiple` | Field stores an array of values |
| `options` | Required for `dataType: option`. List of `{ key, name, description? }` (or just keys) |
| `domain` | Restrict which types can carry this field (relation field on Type) |
| `range` | Restrict relation targets to specific types |
| `inverseOf` | Bidirectional sync target. See Relations |
| `unique` | Enforce uniqueness across the namespace |
| `default` | Default value when field is unset |
| `attributes` | Other Fields whose values can annotate this field's values |
| `plaintextFormat` / `richtextFormat` / `sectionDepth` / `periodFormat` | Format constraints |
| `when` | Conditional applicability, e.g. `when: { dataType: option }` (used by built-in `options` field). Advanced — most schemas don't need it |

## Built-in Record Fields

Defined in `packages/repo/src/model/record-schema.ts`. Reuse before defining custom equivalents.

**Identity & labeling** (core, all namespaces): `id`, `uid`, `key`, `type`, `name`, `description`, `tags`

**Content** (record only):
- `title` — `plaintext line`, primary heading
- `summary` — `richtext block[]`, post-hoc short version of body
- `details` — `richtext section` at `sectionDepth: 2`, structured body
- `content` — `richtext document`, full body with own heading hierarchy

**External**:
- `url` — `uri`, primary link
- `references` — `uri[]`, related external resources
- `sourceFiles` — `plaintext filepath[]`, source paths

**Classification**:
- `status` — `option`, lifecycle. Options: `draft`, `pending`, `active`, `paused`, `complete`, `cancelled`
- `priority` — `option`, importance. Options: `p0` (Blocker), `p1` (Urgent), `p2` (High), `p3` (Medium), `p4` (Low)
- `source` — `plaintext line`, provenance label for imported data

**Temporal**: `dueDate` (date), `startDate` (date), `completedAt` (datetime)

**Structural relations** (all `relation` data type):
- Hierarchy: `parent` ↔ `children`
- Order: `previous` ↔ `next`
- Containment: `partOf` ↔ `contains`
- Dependency: `requires` ↔ `requiredBy`
- Symmetric: `relatesTo` ↔ `relatesTo`

**System-managed** (do not set, `userReadonly: true`): `createdAt`, `updatedAt`, `createdBy`, `updatedBy`. `id` and `uid` are also immutable identity fields you never set.

Attach a built-in to a type without redefining — just reference its key under `fields`:

```yaml
- key: Task
  type: Type
  fields:
    - title: { required: true }
    - status: { default: pending, only: [pending, active, complete, cancelled] }
    - priority
    - parent: { only: [Task] }
    - children: { only: [Task] }
```

## Enums and Constraints

Field definitions are global; per-type constraints live on the Type's `fields` list. Use them to restrict a shared field for one type without forking it.

| Constraint | Applies to | Use when |
|---|---|---|
| `required: true` | Any field | The type cannot exist without this field set |
| `default: <value>` | Any field with a default | Set initial value when omitted on create |
| `only: [a, b, c]` | `option` field | Subset the global enum for this type. E.g. global `status` has 6 values; restrict `Task.status` to a 3-value workflow |
| `only: [TypeA, TypeB]` | `relation` field | Restrict relation targets to specific types. E.g. `Task.parent: { only: [Task, Milestone] }` |
| `exclude: [...]` | `option` or `relation` field | Inverse of `only` — keep all but a few. Use `only` when the kept set is shorter, `exclude` when the rejected set is shorter |
| `description: "..."` | Any field | Per-type doc that overrides the field's general description |
| `value: <value>` | Any field | Pin a constant value for this type (advanced; rarely needed) |

Example using all four common constraints:

```yaml
- key: Task
  type: Type
  fields:
    - title: { required: true }
    - status:
        default: pending
        only: [pending, active, complete, cancelled]
    - priority: { default: p3 }
    - parent: { only: [Task, Milestone] }
```

## System Fields

Auto-managed, do not set on create or update: `id`, `uid`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.

`key` and `type` are user-settable but constrained: `key` is unique within the namespace and validated against the `identifier` format; `type` is immutable once set.

## Best Practices

1. Run `binder schema` and `binder schema -n config` before adding types or fields. Reuse the built-ins (see Built-in Record Fields above) — `title`, `name`, `description`, `tags`, `status`, `priority`, `parent`/`children`, `partOf`/`contains`, `requires`/`requiredBy`, `relatesTo`, `dueDate`, etc. — instead of duplicating.
2. Verify `dataType` against the live schema before defining custom fields:
   ```bash
   binder schema -n config --format yaml | awk '/key: dataType/,/^  [a-z]/' | head -40
   ```
3. Reuse fields across types — don't duplicate.
4. Use `only` constraints to restrict relation targets per type and to subset enum options per type.
5. Always define `inverseOf` for bidirectional relations.
6. Preview with `binder tx import -d` before applying — but **do not trust dry-run for `dataType` validity**. Dry-run is lenient about dataType values; an invalid `dataType` may pass dry-run and fail apply with an opaque "failed creating changeset" error and an empty log. If apply fails after a clean dry-run, suspect dataType first; bisect the transaction by halving configs to isolate the offender.
7. When in doubt, split schema changes into two transactions: fields first, then types that reference them.
8. Avoid generic field names (`state`, `kind`, `type`). Prefer names that say what the field means at the query site (`publishStatus`, `format`, `qualityChecks`).
9. Don't model entities for taxonomy you can express as enums or freeform tags. Promote a tag/pillar to its own type only when it needs its own fields (description, owner, history).

## References

- [Relations & inverse patterns](references/relations.md)
- [Field attributes](references/field-attributes.md)
- [Views](references/views.md)
- [Navigation](references/navigation.md)

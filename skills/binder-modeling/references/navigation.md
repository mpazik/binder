# Navigation

A `Navigation` config entity maps a query to a file path and a view, materializing entities as files. Defined in transactions alongside `Field`, `Type`, and `View`.

Source: `packages/cli/src/document/navigation.ts`, `change-extractor.ts`, `lib/snapshot.ts`. Full concept doc: `docs/concepts/navigation.md`.

## Minimal Shape

```yaml
- author: system
  configs:
    - key: nav-tasks
      type: Navigation
      path: tasks/{key}
      where: { type: Task }
      view: task-view
```

## Item Properties

| Property | Purpose |
|---|---|
| `path` | File path pattern with `{field}` interpolation |
| `where` | Filter selecting which entities this item renders, e.g. `{ type: Task }` |
| `view` | Reference to a `View` config entity |
| `includes` | Optional field selection — controls what data the view sees |
| `query` | Optional full query params for list-style rendering with embedded queries |
| `children` | Nested navigation items inheriting parent entity context |

## File Type Inference

- Path **with** a `view` → markdown file (`.md`)
- Path **without** a `view` → YAML file (`.yaml`)
- Path ending with `/` → directory containing children

## Path Interpolation

`{fieldName}` placeholders are filled per entity, sanitised for filesystem safety.

- Placeholders are constrained to **a single path segment** — they cannot contain `/`. This prevents a less-specific pattern like `tasks/{priority} {key}` from greedily consuming paths meant for a more specific sibling
- If any referenced path field is `null`/`undefined` (including parent placeholders), the entity is skipped for that item and a warning is logged

```yaml
path: tasks/{key}          # → tasks/implement-auth.md
path: milestones/{key}     # → milestones/alpha-release.md
path: projects/{key}/      # → projects/core-platform/ (directory for children)
```

## Multi-value Field Fan-out

When a path references an `allowMultiple` field at depth 0 and the entity holds an array, the system produces one file per value. Multiple multi-value fields produce the cartesian product.

```yaml
# Entity: { key: fix-auth, tags: [backend, security] }
path: by-tag/{tags}/{key}
# → by-tag/backend/fix-auth.yaml
# → by-tag/security/fix-auth.yaml
```

Each fan-out path receives a **narrowed entity** — the multi-value field holds only the value used for that path. Children see this narrowed entity as their parent context, so `{parent.tags}` resolves to the single value.

Empty array is treated like a missing field — entity skipped, warning logged.

## Nested Navigation

Children inherit parent entity context:

```yaml
- key: nav-projects
  type: Navigation
  path: projects/{key}/
  where: { type: Project }
  children:
    - path: tasks/{key}
      where: { type: Task, parent: "{parent.uid}" }
      view: task-view
```

## Create-by-File

Items with a `where` clause support reverse sync: dropping a new file at a matching path **creates** an entity. The `where` filters seed the entity along with fields extracted from the file path and content. Items without `where` only render existing entities.

## Rendering Pipeline

1. Load navigation items from config namespace, build tree
2. For each item: run `where` against the entity store
3. For each match: resolve the file path (skip + warn on null path fields)
4. Render content: apply view (markdown) or serialise fields (YAML)
5. Save snapshot with version tracking
6. Recurse into `children` with current entity as context
7. Cleanup: remove snapshot files not rendered this pass

If an item fails, the error is logged and rendering continues. Orphan cleanup runs only against successfully rendered paths. Errors accumulate into a partial-failure result.

## Config Namespace Navigation

The system has built-in navigation for its own schema:

- `.binder/fields/` — field definitions
- `.binder/types/` — type definitions
- `.binder/navigation/` — navigation items themselves
- `.binder/views/{key}` — view definitions

Schema is browsable and editable as files via the same pipeline.

## Entity Location Resolution

Given an entity, the system finds its file location by scoring navigation items by specificity: individual files > list entries, markdown > YAML, simpler paths > deeply nested ones. Powers "go to definition" and entity-to-file linking.

## Workspace Example

```yaml
- author: system
  configs:
    - key: nav-milestones
      type: Navigation
      path: milestones/{key}
      where: { type: Milestone }
      view: milestone-view

    - key: nav-tasks
      type: Navigation
      path: tasks/{title}
      where: { type: Task }
      view: task-view

    - key: nav-decisions
      type: Navigation
      path: decisions/{key}
      where: { type: Decision }
      view: decision-view
```

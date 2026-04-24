---
key: navigation
name: Navigation
tags: [ rendering ]
status: active
description: The configuration that materializes repository data as files on disk. Navigation items map entity queries to file paths and views, turning structured data into a browsable, editable file tree.
alternativeNames: [ navigation config, routing, rendering pipeline ]
sourceFiles:
  - packages/cli/src/document/navigation.ts
  - packages/cli/src/document/change-extractor.ts
  - packages/cli/src/lib/snapshot.ts
relatesTo:
  - view
  - query
  - type
---

# Navigation

## Details

### Overview

Entities in a repository are structured data. Navigation turns them into files you can browse, read, and edit. Without navigation, data lives only in the database. With it, your workspace becomes a folder of markdown and YAML files that stay in sync with the underlying entities.

Each navigation item is a config entity that specifies a file path pattern, a filter to select entities, and a view to render them. Together they define the complete file structure of a workspace.

### Navigation Item Structure

A navigation item contains:
- **path**: file path pattern with field interpolation like `tasks/{key}`, `milestones/{key}`
- **where**: filters that select which entities this item renders like `{ type: Task }`
- **view**: reference to a View config entity that defines rendering
- **includes**: optional field selection, controls what data is available to the view
- **query**: optional full query params for list-style rendering with embedded queries
- **children**: nested navigation items that inherit parent entity context

### File Type Inference

The system infers the output format from the navigation item:
- Path with a view → **markdown** file (`.md`)
- Path without a view → **YAML** file (`.yaml`)
- Path ending with `/` → **directory** containing child items

### Path Resolution

Path patterns use `{fieldName}` interpolation. When rendering, the system resolves each entity's field values into the path, sanitising for filesystem safety.

Placeholder values are constrained to a single path segment — they cannot contain `/`. This ensures that when matching a file path back to a navigation rule, a less-specific pattern like `tasks/{priority} {key}` does not greedily consume paths meant for a more specific sibling like `tasks/backlog/{priority} {key}`.

If any referenced path field resolves to `null` or `undefined` (including parent/ancestral placeholders), that entity is skipped for that navigation item and a warning is logged. This prevents invalid outputs such as empty filename segments.

```yaml
path: tasks/{key}          # → tasks/implement-auth.md
path: milestones/{key}     # → milestones/alpha-release.md
path: projects/{key}/       # → projects/core-platform/ (directory for children)
```

#### Multi-value field fan-out

When a path pattern references a multi-value field (one with `allowMultiple`) at depth 0 (the current entity) and the entity holds an array value for that field, the system fans out — producing one file per value. If multiple multi-value fields appear in the same pattern, the cartesian product of their values is produced.

```yaml
# Entity: { key: fix-auth, tags: [backend, security] }
path: by-tag/{tags}/{key}
# → by-tag/backend/fix-auth.yaml
# → by-tag/security/fix-auth.yaml
```

Each fan-out path receives a **narrowed entity** where the multi-value field is set to the single value used for that path. Child navigation items see this narrowed entity as their parent context, so `{parent.<field>}` resolves to the specific value rather than the full array.

An empty array value is treated the same as a missing field — the entity is skipped and a warning is logged.

#### Nested navigation

For nested navigation, child items inherit parent entity context. A child can reference parent fields in its path and query:

```yaml
- path: projects/{key}/
  where: { type: Project }
  children:
    - path: tasks/{key}
      where: { type: Task }
      view: task-view
```

### Rendering Pipeline

The full rendering flow:
1. **Load navigation**: fetch navigation items from config namespace, build tree
2. **For each item**: execute the `where` filter as a query against the entity store
3. **For each matching entity**: resolve the file path from the path pattern (skip + warn when required path fields are null/undefined)
4. **Render content**: apply the view (markdown) or serialise fields (YAML)
5. **Save snapshot**: write the file with version tracking metadata
6. **Recurse children**: process child navigation items with parent entity as context
7. **Cleanup orphans**: remove snapshot files that were not rendered in this pass

If a navigation item fails to render, the error is logged and collected but rendering continues with the remaining items. Orphan cleanup runs against the successfully rendered paths, so stale files from items that did render are still removed. When any errors were collected, the overall result is a partial failure containing both the rendered output and the accumulated errors.

### Create by File

Navigation items that include a `where` clause support the reverse direction: dropping a new file at a matching path creates a new entity during sync. The `where` filters (e.g. `type: Task`) seed the entity alongside fields extracted from the file path and content. Items without `where` do not support this — sync requires the entity to already exist.

### Config Navigation

The config namespace has hardcoded navigation items for system entities:
- `.binder/fields/`: field definitions
- `.binder/types/`: type definitions
- `.binder/navigation/`: navigation items themselves
- `.binder/views/{key}`: view definitions

The system's own schema is rendered and editable as files, using the same pipeline as user data.

### Entity Location Resolution

Given an entity, the system can find its file location by matching against navigation items. This powers "go to definition" in editors and entity-to-file linking. Items are scored by specificity — individual files score higher than list entries, markdown higher than YAML, simpler paths higher than deeply nested ones.

### Example

A complete workspace navigation:

```yaml
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

Each navigation item creates a file per matching entity, rendered with its view, forming the workspace's file tree.

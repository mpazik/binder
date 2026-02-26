---
status: active
description: Config entities that map entity queries to file system paths and templates, driving the rendering pipeline. Navigation defines which entities are rendered, where files are placed, and which template is used — the bridge between structured data and the file system.
alternativeNames: [ navigation config, routing, rendering pipeline ]
tags: [ rendering ]
sourceFiles:
  - packages/cli/src/document/navigation.ts
  - packages/cli/src/document/synchronizer.ts
  - packages/cli/src/lib/snapshot.ts
relatesTo: [ 3v99hepn69A, 2Wz5hDRrdzc, 2J9ouH8xZek ]
---

# Navigation

### Overview

Navigation is the configuration layer that connects entities to the file system. Each navigation item is a config entity that specifies a file path pattern, a filter to select entities, and a template to render them. Together, navigation items define the complete file structure of a workspace — which entities get files, where those files live, and how they look.

### Navigation Item Structure

A navigation item contains:
- **path** — file path template with field interpolation (e.g., `tasks/{key}`, `milestones/{key}`)
- **where** — filters that select which entities this item renders (e.g., `{ type: Task }`)
- **template** — reference to a Template config entity that defines rendering
- **includes** — optional field selection for the query (controls what data is available to the template)
- **query** — optional full query params (for list-style rendering with embedded queries)
- **children** — nested navigation items that inherit parent entity context

### File Type Inference

The system infers the output format from the navigation item:
- Path with a template → **markdown** file (`.md`)
- Path without a template → **YAML** file (`.yaml`)
- Path ending with `/` → **directory** containing child items

### Path Resolution

Path templates use `{fieldName}` interpolation. When rendering, the system resolves each entity's field values into the path, sanitising for filesystem safety:

```yaml
path: tasks/{key}          # → tasks/implement-auth.md
path: milestones/{key}     # → milestones/alpha-release.md
path: projects/{key}/       # → projects/core-platform/ (directory for children)
```

For nested navigation, child items inherit parent entity context. A child can reference parent fields in its path and query:

```yaml
- path: projects/{key}/
  where: { type: Project }
  children:
    - path: tasks/{key}
      where: { type: Task }
      template: task-template
```

### Rendering Pipeline

The full rendering flow:
1. **Load navigation** — fetch navigation items from config namespace, build tree
2. **For each item** — execute the `where` filter as a query against the entity store
3. **For each matching entity** — resolve the file path from the path template
4. **Render content** — apply the template (markdown) or serialise fields (YAML)
5. **Save snapshot** — write the file with version tracking metadata
6. **Recurse children** — process child navigation items with parent entity as context

### Config Navigation

The config namespace has hardcoded navigation items for system entities:
- `.binder/fields/` — field definitions
- `.binder/types/` — type definitions
- `.binder/navigation/` — navigation items themselves
- `.binder/templates/{key}` — template definitions

This means the system's own schema is rendered and editable as files, using the same pipeline as user data.

### Entity Location Resolution

Given an entity, the system can find its file location by matching against navigation items. This powers "go to definition" in editors and entity-to-file linking. Items are scored by specificity — individual files score higher than list entries, markdown higher than YAML, simpler paths higher than deeply nested ones.

### Example

A complete workspace navigation:

```yaml
- key: nav-milestones
  type: Navigation
  path: milestones/{key}
  where: { type: Milestone }
  template: milestone-template

- key: nav-tasks
  type: Navigation
  path: tasks/{title}
  where: { type: Task }
  template: task-template

- key: nav-decisions
  type: Navigation
  path: decisions/{key}
  where: { type: Decision }
  template: decision-template
```

Each navigation item creates a file per matching entity, rendered with its template, forming the workspace's file tree.

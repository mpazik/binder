---
status: active
description: The complete set of user-defined types, fields, and relations that give structure to repository data. Vocabulary is stored as entities in the config namespace and evolves dynamically through transactions without breaking existing records.
alternativeNames: [ schema, meta-model, structure, blueprint ]
tags: [ data-model ]
sourceFiles: [ packages/db/src/model/schema.ts, packages/db/src/schema.ts ]
relatesTo: [ 2J9ouH8xZek, 4zRN90q4XDM, __RaTedhj9s, 7RVmgYuEPQI ]
---

# Vocabulary

### Overview

Vocabulary is the user-defined schema that gives structure to repository data. It consists of field definitions, type definitions, and their relationships — all stored as entities in the config namespace. Because vocabulary is "schema as data," it can be queried, versioned, and evolved through the same transaction mechanism as any other data.

### Composition

A vocabulary comprises:
- **Fields** — reusable properties with data types and constraints (e.g., `status`, `assignedTo`, `dueDate`)
- **Types** — entity classes that compose fields with contextual constraints (e.g., `Task`, `Project`, `User`)
- **Relations** — connections between types via relation-typed fields with optional inverse definitions

### Dynamic Schema Evolution

Vocabulary evolves through transactions, following the same change tracking as all other data:
- Add new fields and types at any time without breaking existing records
- Entities don't need to conform strictly to their type — structure emerges gradually
- Complete audit trail of all schema changes via the transaction log
- Schema changes are atomic — a new type with its fields can be created in a single transaction

### Schema Format for LLM Context

A standardised compact format optimised for LLM comprehension and token efficiency:

```
FIELDS:
• title: string - Descriptive label
• status: todo|in_progress|done - Current state
• assignedTo: User|Team - Responsible party

TYPES:
• Task [title{required}, status{default: todo}, assignedTo]
• Bug <Task> [severity, stepsToReproduce]
```

Design principles:
- Uses patterns LLMs recognise from training (bullets, TypeScript syntax, HTML-style attributes)
- Token-efficient to preserve context window space
- Colon syntax (`fieldName: Type`) familiar from TypeScript/YAML
- Constraint attributes (`{required}`, `{default: X}`) are concise and composable

### Conversational Configuration

Users interact with vocabulary through a Configuration Assistant, which provides a conversational interface for defining custom attributes and data types, creating entity types, setting up relationships, and evolving schema over time without breaking existing data.

### Benefits for LLM Operations

- **Improved extraction** — LLMs have a schema to follow, preventing hallucination of non-existent fields or types
- **Easier UI navigation** — cross-linked data model enables users to jump to related items without manually maintaining links
- **Search through references** — cross-linked data model enables more accurate search results by following relationships

### Use Cases

- **Project tracking** — custom attributes for projects (status, priority, deadline), tasks (assignee, story points), milestones
- **Customer feedback** — feedback entries (source, sentiment, category), customer profiles (tier, industry), product features
- **Hiring system** — candidates (skills, experience), positions (requirements, department), interview processes
- **Expense tracking** — expense categories, approval workflows, cost centres, employee profiles
- **LLM long-term memory** — structured conversation context, user preferences, and domain knowledge queryable through MCP tools for personalised responses

### Vocabulary Bank (Future)

A curated library of reusable field and type definitions that users can pick from before creating custom items. Items from the bank would carry provenance tracking back to the source for managed updates. The challenge is that fields tend to cluster — ideally this would be a large, granular DAG users can cherry-pick from.

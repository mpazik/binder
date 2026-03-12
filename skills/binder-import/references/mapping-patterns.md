# Mapping Patterns

Concrete examples of mapping common source formats to Binder transaction YAML.

## CSV with Headers

Source:
```csv
name,priority,assigned_to,due_date,status
Implement auth,P1,Alice,03/15/2025,in progress
Write tests,P3,Bob,03/20/2025,todo
```

Mapping:
- `name` -> `title` (direct)
- `priority` -> `priority` (normalize: P1=high, P2=medium, P3=low)
- `assigned_to` -> `assignee` (lookup User by name)
- `due_date` -> `dueDate` (parse MM/DD/YYYY to ISO)
- `status` -> `status` (normalize: "in progress"=active, "todo"=pending)

Transaction:
```yaml
- author: import
  records:
    - type: Task
      title: Implement auth
      priority: high
      assignee: usr-k8f2m1
      dueDate: "2025-03-15"
      status: active
    - type: Task
      title: Write tests
      priority: low
      assignee: usr-p3n7x9
      dueDate: "2025-03-20"
      status: pending
```

## JSON Array

Source:
```json
[
  {
    "id": "EXT-001",
    "title": "Design review",
    "tags": ["design", "review"],
    "subtasks": [
      { "title": "Prepare mockups" },
      { "title": "Schedule meeting" }
    ]
  }
]
```

This has nested subtasks. Two approaches:

**Flat (skip subtasks)**: import top-level items only, note what was skipped.

**Two-pass (preserve hierarchy)**:
1. First batch: create parent records, note their UIDs from output
2. Second batch: create subtask records with `parent` set to the UIDs from pass 1

Transaction (pass 1):
```yaml
- author: import
  records:
    - type: Task
      title: Design review
      externalId: EXT-001
      tags:
        - design
        - review
```

Transaction (pass 2, after obtaining parent UID):
```yaml
- author: import
  records:
    - type: Task
      title: Prepare mockups
      parent: tsk-a1b2c3
    - type: Task
      title: Schedule meeting
      parent: tsk-a1b2c3
```

## YAML List

Source:
```yaml
- name: Project Alpha
  lead: Alice
  status: active
  milestones:
    - Q1 launch
    - Q2 expansion

- name: Project Beta
  lead: Bob
  status: planning
```

Mapping: `name` -> `title`, `lead` -> `lead` (relation to User), `status` -> `status`, `milestones` -> depends on schema.

If `milestones` is a multi-value string field:
```yaml
- author: import
  records:
    - type: Project
      title: Project Alpha
      lead: usr-k8f2m1
      status: active
      milestones:
        - Q1 launch
        - Q2 expansion
```

If milestones are separate entities, use the two-pass approach.

## Markdown Directory with Frontmatter

Source files (`docs/meetings/2025-03-10.md`):
```markdown
---
date: 2025-03-10
attendees: [Alice, Bob]
type: standup
---

# Daily Standup

## Updates
- Alice: finished auth module
- Bob: started test suite

## Action Items
- [ ] Alice: deploy to staging
- [ ] Bob: write integration tests
```

Mapping decisions:
- Frontmatter fields map directly: `date`, `attendees` (relation to User), meeting type
- Body content: store as `notes` (richtext) or parse sections into separate fields
- Action items: could become separate Task records linked to the meeting

Transaction:
```yaml
- author: import
  records:
    - type: Meeting
      meetingType: standup
      date: "2025-03-10"
      attendees:
        - usr-k8f2m1
        - usr-p3n7x9
      notes: |
        ## Updates
        - Alice: finished auth module
        - Bob: started test suite
```

## Markdown Directory without Frontmatter

Source files (`notes/design-principles.md`):
```markdown
# Design Principles

Keep interfaces minimal. Prefer composition over inheritance.

## Simplicity
Less is more. Every feature must justify its complexity cost.

## Consistency
Same concept, same pattern, everywhere.
```

Options:
- **Whole file as one record**: `title` from H1, `content` from body
- **Sections as records**: each H2 becomes a record, linked to a parent record from H1

Transaction (whole file):
```yaml
- author: import
  records:
    - type: Note
      title: Design Principles
      description: |
        Keep interfaces minimal. Prefer composition over inheritance.
      content: |
        ## Simplicity
        Less is more. Every feature must justify its complexity cost.

        ## Consistency
        Same concept, same pattern, everywhere.
```

## Markdown Table

Source (inside a file):
```markdown
| Feature       | Priority | Owner   | Status   |
|---------------|----------|---------|----------|
| Dark mode     | High     | Alice   | Done     |
| Export PDF     | Medium   | Bob     | Pending  |
| API v2        | High     | Charlie | Active   |
```

Parse table rows as records. Headers become field candidates. Same mapping process as CSV.

## Mixed-Type Import

When a source contains multiple entity types (e.g. a project export with projects, tasks, and people):

1. Group by target type
2. Import in dependency order: Users first, then Projects, then Tasks (so relations can reference existing UIDs)
3. Each type gets its own batch

```yaml
# Batch 1: Users
- author: import
  records:
    - type: User
      title: Alice
      email: alice@example.com
    - type: User
      title: Bob
      email: bob@example.com

# Batch 2: Projects (after User UIDs are known)
- author: import
  records:
    - type: Project
      title: Project Alpha
      lead: usr-k8f2m1
```

## Handling Ambiguous Values

Common transformations to document in the mapping step:

| Pattern | Resolution |
|---------|-----------|
| Free-text where option expected | Normalize to closest option, list exceptions for user |
| Name where relation expected | Search for existing record, ask user about unmatched names |
| Combined value (e.g. "Alice, Bob") | Split into array for `allowMultiple` field |
| Empty/null | Omit field (let default apply) or set explicit value per user preference |
| Date in unknown format | Show samples, confirm format with user before parsing |

---
name: capture-task
description: Capture a new task — create a draft or pending Task record from a rough idea or detailed spec. Use when asked to "add a task", "log a bug", "create a task", or "add to backlog".
argument-hint: description of the task to capture
---

Capture the following as a Task in the binder knowledge graph.

$ARGUMENTS

If no input was given above, ask the user what to capture.

## Key Convention

Format: `{taskType}-{short-slug}`, kebab-case. Must be usable as a git branch name. 2-7 words, max 70 chars.

Examples: `fix-sync-null-values`, `feat-export-csv`, `tweak-sidebar-padding`, `docs-api-reference`

## Fields

**Captured** — taken directly from user input. Only include what the user actually said:
- `title` (required) — 2-7 words, max 70 chars, no verb prefix
- `taskType` (required) — fix, feat, tweak, refactor, perf, agent, build, docs, test
- `description` — 1-2 sentences with enough context
- `details` — steps to reproduce, useful context, skip obvious background
- `priority` — p0=Blocker, p1=Urgent, p2=High, p3=Medium (default), p4=Low
- `sourceFiles` — paths to relevant source files, when the user mentions them

**Inferred** — derived by the agent. Clearly marked so the user can correct. For `acceptanceCriteria`, `constraints`, and `outOfScope`: only propose when obvious from context. Better empty than hallucinated.
- `key` — generated from taskType + title slug
- `module` — which part of the codebase this belongs to
- `size` — **small**: few files, no design decisions. **medium**: several files, 1-2 decisions. **large**: multiple commits, non-trivial decisions
- `priority` — if user didn't specify, default p3
- `acceptanceCriteria` — optional, testable scenarios
- `constraints` — optional, what must hold or not change
- `outOfScope` — optional, what this task deliberately does not cover

Run `binder schema --types Task` for the full Task schema and available field values.

## Flow

### 1. Parse and assemble
Extract fields from user input. Infer what you can. Check for duplicates against Context below.

If a duplicate is found:
- **Exact duplicate** — tell the user, don't create. Link to the existing task.
- **Partial overlap** — tell the user. They can merge into the existing task or keep both.
- **Related but distinct** — note it. If created, link with `relatesTo`.

### 2. Propose
Present the record to the user with captured and inferred fields clearly separated.

Example:
```
Captured:
  title: Sync crashes on null values
  taskType: fix
  description: EntitySync throws when a field value is null...

Inferred:
  key: fix-sync-null-values
  module: db
  size: small
  priority: p3
```

### 3. User decides
- **Approve** → create the task as `draft`
- **Correct inferences** → adjust and create as `draft`
- **"Let's finalize it"** → go to step 4

If all 6 core DoR fields are present and only type/size-specific fields or links are missing, offer:
"This is close to ready — want to finalize it to pending?"

### 4. Finalize to pending (optional)
Only if user wants to. This is the expensive step:
- Fill remaining DoR fields through conversation
- Search for related items to set links:
  - `requires` — dependencies on other tasks or problems
  - `relatesTo` — related features, concepts, or tasks
  - `partOf` — assign to a milestone
- Use these commands to find candidates:
  - `binder search type=Task status=pending,active -f "key,title,taskType,status,partOf" --format tsv`
  - `binder search type=Milestone status=active,draft -f "key,title,status" --format tsv`
  - `binder search type=Feature -f "key,title,description" --format tsv`
  - `binder search type=Concept -f "key,title,description" --format tsv`
  - `binder search type=Problem -f "key,title,status" --format tsv`
- Verify DoR, propose updated record as `pending`, wait for approval
- If the user stops or declines mid-finalize, keep the task as `draft` with whatever fields are filled so far

### Definition of Ready

Required for all tasks: `title`, `taskType`, `size`, `priority`, `module`, `description`.

Additional by size:
- **medium+ tasks:** `constraints`
- **large tasks:** `outOfScope`

Additional by type:
- **feat tasks:** `acceptanceCriteria` with testable scenarios
- **fix tasks:** `acceptanceCriteria` (how to verify the fix)
- **refactor tasks:** `constraints` stating what behavior must not change

Links: `partOf` (milestone), `relatesTo` (features, concepts), `requires` (dependencies).

## Writing List Fields

Use newline-delimited syntax for list fields like `acceptanceCriteria`, `constraints`, `outOfScope`, `sourceFiles`:

```bash
binder update <key> $'acceptanceCriteria=Exports all visible columns\nHandles special characters\nWorks with filtered results'
```

Append a single item with `+=`:

```bash
binder update <key> 'constraints+=Must not break existing API'
```

## Guidelines

- Always check for duplicates against existing tasks before proposing
- Propose the record to the user and wait for approval before creating
- Keep `description` to a single paragraph (no blank lines)
- Don't repeat the type prefix in the title. "Sidebar crashes on resize" not "Fix sidebar crash on resize"
- For issues encountered during work, add `details` with steps to reproduce
- If the user asks to start work on the task immediately, finalize to `pending` (step 4) then hand off to the `implement-task` skill

## Context

If no tasks are listed below, there are no duplicates to check. If commands fail, ensure the binder workspace is initialized.

### Existing Tasks

!`binder search type=Task status=draft,pending,active -f "key,title,taskType,status" --format tsv`

### Cancelled Tasks

!`binder search type=Task status=cancelled -f "key,title" --format tsv`

### Task Schema

Run `binder schema --types Task` if you encounter any problem with update format.

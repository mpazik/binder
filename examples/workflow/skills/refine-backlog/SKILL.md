---
name: refine-backlog
description: Refine the backlog — screen drafts, remove duplicates, fill in missing details, classify, link, and move to pending
---

Refine draft tasks to meet the Definition of Ready so they can move from `draft` to `pending`.

$ARGUMENTS

If specific tasks were given above, focus on those. Otherwise, work through the draft tasks listed below.

## Draft Tasks

!`binder search type=Task status=draft -f "key,title,taskType,priority,size,partOf" --format tsv`

If no drafts are listed above, tell the user there's nothing to refine and stop.

## Refinement Steps

For each task, work through these steps. Use `binder read <key> --format yaml` to inspect full details first.

Draft tasks from capture may already have fields set. Respect what's there -- only fill gaps unless user said otherwise.

### 1. Duplicate Check
- Compare against existing tasks, features, and concepts in Context below
- Also check cancelled tasks — don't recreate something deliberately cancelled
- If overlap found:
  - **Exact duplicate** → cancel the draft, link to the existing one
  - **Partial overlap** → merge the unique parts into the existing task, cancel the draft
  - **Related but distinct** → keep both, link with `relatesTo`

### 2. Classify
- Set `taskType` if missing — match to the closest category (fix, feat, tweak, refactor, perf, agent, build, docs, test)
- Set `size` if missing — **small**: few files, no design decisions. **medium**: several files, 1-2 decisions. **large**: multiple commits, non-trivial decisions required.
- Set `priority` if missing — p0=Blocker, p1=Urgent, p2=High, p3=Medium (default), p4=Low
- Set `module` if missing — which part of the codebase this belongs to
- Set `sourceFiles` if relevant files are obvious from the description

### 3. Describe
- Improve `title` if unclear (2-7 words, no verb prefix, max 70 chars)
- Write `description` if missing (1-2 sentences with enough context)

### 4. Definition of Ready
Required for all tasks: `title`, `taskType`, `size`, `priority`, `module`, `description`.
Additional by size:
- **medium+ tasks:** add `constraints`
- **large tasks:** add `outOfScope`

Additional by type:
- **feat tasks:** add `acceptanceCriteria` with testable scenarios
- **fix tasks:** add `acceptanceCriteria` (how to verify the fix)
- **refactor tasks:** add `constraints` stating what behavior must not change

For `acceptanceCriteria`, `constraints`, and `outOfScope`: propose to the user for validation. Don't fill these silently -- better empty than hallucinated.

### 5. Split
- If a task touches multiple independent concerns or modules, split it
- Create new draft tasks for each piece (`binder create Task <key> title=... taskType=... ...`), link them as `children` of the original
- The original becomes a parent task — set its status to `pending`, keep its description as the umbrella summary
- Each child stays as `draft` and goes through the remaining refinement steps independently
- Each child should be independently implementable and testable

### 6. Link
- Set `requires` for dependencies on other tasks or problems
- Link related concepts or features with `relatesTo`
- Assign to a milestone via `partOf` if appropriate

## Session Guidance

- If there are more than 10 drafts, ask the user which to focus on or suggest a batch size
- Present each task's proposed changes before applying
- If a draft is too vague to refine, ask the user for clarification rather than guessing
- Tasks captured with full details may already be `pending` — verify their DoR and links, but don't re-do classification from scratch

## Instructions

- Use Binder CLI (`binder read/search/update/tx`) for all reads and updates
- Propose changes to the user and wait for approval before executing
- Do not move to `pending` without evaluating step 6 (Link) — every link type must be considered, but not every task needs all links
- After refinement, move tasks from `draft` to `pending`
- After moving to `pending`, verify the Definition of Ready fields are all filled
- Summarize all changes at the end: tasks refined, cancelled, split, linked
- If the user asks to start or pick up a task, use the `implement-task` skill

## Writing List Fields

Use newline-delimited syntax for list fields like `acceptanceCriteria`, `constraints`, `outOfScope`, `sourceFiles`:

```bash
binder update <key> $'acceptanceCriteria=Exports all visible columns\nHandles special characters\nWorks with filtered results'
```

Append a single item with `+=`:

```bash
binder update <key> 'constraints+=Must not break existing API'
```

## Context

If no items are listed in a section below, that category is empty. If commands fail, ensure the binder workspace is initialized.

### Task Schema

!`binder schema --types Task`

### Existing Tasks

!`binder search type=Task status=pending,active,complete -f "key,title,taskType,status,partOf" --format tsv`

### Cancelled Tasks

!`binder search type=Task status=cancelled -f "key,title" --format tsv`

### Milestones

!`binder search type=Milestone status=active,draft -f "key,title,status,description" --format tsv`

### Features

!`binder search type=Feature -f "key,title,description" --format tsv`

### Concepts

!`binder search type=Concept -f "key,title,description" --format tsv`

### Problems

!`binder search type=Problem -f "key,title,status" --format tsv`

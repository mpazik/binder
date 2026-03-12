---
description: Implement a task — pick up a pending task, plan the approach, write the code, verify, and mark complete
---

Implement a task from the backlog.

$@

If a specific task was given above, use that. Otherwise, show pending tasks and ask which one to pick up.

## Pending Tasks

!`binder -C ../main search type=Task status=pending -f "key,title,taskType,priority,size,module,partOf" -o "!priority" --format tsv`

## Workflow

### 1. Pick Up

- Read the full task: `binder read <key> --format yaml`
- Run setup: `bun ../main/workflow/task-setup.ts <key>`
- Move to active: `binder update <key> status=active`

### 2. Understand

- Read the task's `description`, `details`, `acceptanceCriteria`, `constraints`, `outOfScope`
- Check `requires` — are dependencies met?
- Check `sourceFiles` — read the relevant code
- Check `potentialSolution` if present — consider it but don't treat it as binding
- Look at related tasks and features for context

### 3. Plan

- Outline the approach: which files to change, in what order
- Identify risks or ambiguities
- Present the plan to the user and wait for approval before writing code

### 4. Implement

- Make changes following the plan
- Keep commits small and focused
- Follow existing code style and patterns in the codebase
- If the task has `constraints`, verify they are respected throughout

### 5. Verify

- Run tests: `bun test`
- Run type check: `bun run check`
- If the task has `acceptanceCriteria`, verify each one explicitly
- If tests fail, fix before proceeding

### 6. Complete

- Update the task: `binder update <key> status=complete`
- Summarize what was done: files changed, approach taken, any decisions made
- If new issues were discovered during implementation, capture them as draft tasks using the `capture-task` skill

## Instructions

- Use Binder CLI for all task reads and updates
- Propose the plan to the user before writing code
- Do not mark complete until verification passes
- If a task is too large or ambiguous, suggest splitting it and refer to `refine-backlog`
- If blocked by a dependency, flag it and ask the user how to proceed

## Context

### Task Schema

!`binder -C ../main schema --types Task`

### Active Tasks

!`binder -C ../main search type=Task status=active -f "key,title,taskType,module" --format tsv`

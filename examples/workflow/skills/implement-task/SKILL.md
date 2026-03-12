---
name: implement-task
description: Pick up and work on a binder Task — investigate bugs, discuss open questions, design solutions, write tests, or implement code. Use when asked to "work on", "pick up", "implement", or "fix" a task.
user-invocable: true
argument-hint: task key (e.g. fix-sync-null-values)
---

Work on a task. Provide a task key, or omit to pick from the lists below.

$ARGUMENTS

If a task key was given above, read it with `binder read <key> --format yaml`. If the key doesn't exist, tell the user and stop. Otherwise, pick from the lists below and then read it.

Check the task's `status`:
- **draft** — needs refinement first, not ready to work on. Tell the user.
- **complete** or **cancelled** — nothing to do. Tell the user.
- **pending**, **active**, **paused** — proceed.

## Active Tasks

!`binder search type=Task status=active -f "key,title,taskType,size,priority,module" --format tsv`

## Pending Tasks

!`binder search type=Task status=pending -f "key,title,taskType,size,priority,module" -o "!priority" --format tsv`

## Choosing a guide

After reading the task, decide which guide to load based on what it needs right now.

| Condition | Guide |
|-----------|-------|
| fix task, `rootCause` empty | [guides/investigate.md](guides/investigate.md) — find root cause |
| `requires` or `relatesTo` links to a Problem record (check linked keys) | [guides/discuss.md](guides/discuss.md) — resolve open questions |
| `specification` empty, and task is medium+, refactor, or agent | [guides/design.md](guides/design.md) — produce a specification |
| fix/feat/refactor/test task that still needs tests | [guides/write-tests.md](guides/write-tests.md) — write tests |
| None of the above apply | [guides/implement.md](guides/implement.md) — implement |

Multiple conditions can match. Start with the topmost one that applies, or follow the user's direction. Read the guide, then follow its instructions.

After completing a guide, re-read the task and check the table again. If another condition applies, load that guide next. If no conditions match, go to implement.

## Updating multi-line fields

For single-value fields: `binder update <key> field=value`

For multi-line or rich text fields (rootCause, specification, details, etc.), use a transaction file:

```yaml
- author: agent
  records:
    - $ref: <key>
      specification: |
        ## Approach
        ...
```

Apply with: `binder tx import <file>` (use `-d` for dry run first).

## Task Schema

!`binder schema --types Task`

# implement-task: To Do

## Missing

- **Multi-session tasks**: medium and large tasks won't finish in one session. No guidance on how to break a session (what to save in task fields, how to hand off to the next session)
- **Progress tracking**: the guides update task fields as they go, but there's no explicit instruction to save partial progress in `details` when stopping mid-work
- **Task selection guidance**: the skill shows pending tasks sorted by priority. Doesn't factor in: dependencies resolved, size fits available time, module matches recent context
- **Related task awareness**: no check for other active tasks touching the same files. Could lead to conflicts
- **Write-tests completion detection**: the routing table can't detect whether tests have been written from task fields alone. Relies on the agent checking for test files or asking the user

## Improvements

- **Cross-skill references**: no mention of `capture-task` for discovered issues or `refine-backlog` for tasks that are too vague. Could add hints in the dispatcher
- **Dependency checking**: the routing table doesn't check `requires` — if dependencies aren't met, the agent should flag it before starting work
- **Guide re-entry**: no guidance on what to do when returning to a guide after interruption. The agent re-reads the task and infers state, but an explicit "check what's already done" step in each guide would help

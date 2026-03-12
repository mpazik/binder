# Implement

Write production code to satisfy the task.

## Context

Read the full task:

```
binder read <key> --format yaml
```

Read files listed in `sourceFiles`. If `specification` is filled, that is the design contract — follow it. If `potentialSolution` is filled, treat it as a starting direction, not a spec. It may be outdated.

If tests exist for this change, read them first. They are the real spec.

## Source of truth

When information conflicts, follow this priority:

1. Existing tests (if they pass, they define correct behavior)
2. `specification` (the agreed design contract)
3. `acceptanceCriteria` (what the task must satisfy)
4. `potentialSolution` (a hint, may be stale)

## Instructions

1. **Read first.** Read the relevant source files before making changes. Search for existing helpers before writing new ones.

2. **Implement.** Make the changes. Follow existing code style and patterns. If `specification` has a Steps section, use it as a guide. If `constraints` exist, respect them throughout.

3. **Verify.** Run the tests. If `acceptanceCriteria` exist, verify each one. Fix failures before considering the work done.

## Scope

Don't add features beyond the task. If you discover issues or improvements during implementation, note them but don't fix them in this change.

When you're done, mention any issues or improvements you noticed. These can be captured as separate draft tasks.

If `outOfScope` lists things, don't touch them.

## Done when

- `acceptanceCriteria` are met (if defined)
- Tests pass
- No unrelated changes

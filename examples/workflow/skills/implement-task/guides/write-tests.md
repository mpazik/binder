# Write Tests

Write tests for the task. The approach depends on the task type and whether production code already exists.

## Context

Read the full task:

```
binder read <key> --format yaml
```

Read existing test files in the area before writing new ones. Follow the patterns you find.

If `sourceFiles` lists files, read them to understand what's being tested.

## Mode

Determine which mode applies:

- **Pre-implementation**: no production code for this change exists yet. Tests should fail now and pass after implementation.
- **Post-implementation**: production code already exists. Tests should pass now.

## What to test by task type

**fix** — Write a reproduction test.
- Use `stepsToReproduce` and `rootCause` to understand the trigger
- Derive test cases from `acceptanceCriteria`
- Pre-impl: the test must fail now (it reproduces the bug)
- Post-impl: the test must pass (it covers the fix)

**feat** — Write acceptance tests.
- One test per acceptance criterion where practical
- Cover happy path, edge cases, and error cases
- Pre-impl: tests must fail (no production code yet)
- Post-impl: tests must pass

**refactor** — Write behavior-locking tests.
- Check that behavior in `constraints` is already covered by existing tests
- Add tests for preserved behavior that isn't covered
- These tests must pass now (they lock behavior before refactoring)

**test** — This is the task. Write the tests described in `acceptanceCriteria`.

## Instructions

1. Read the task fields relevant to testing: `acceptanceCriteria`, `constraints`, `stepsToReproduce`, `rootCause`, `specification`.
2. Read existing tests in the module/area.
3. Write tests following existing patterns and conventions.
4. Run the tests to confirm they're in the expected state (failing for pre-impl, passing for post-impl and refactor).

## Done when

- Tests exist for the task's requirements
- Tests are in the expected pass/fail state for the current mode

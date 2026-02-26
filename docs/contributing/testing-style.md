---
key: testing-style
tags: [ contributing ]
description: Testing conventions and patterns used across the binder codebase.
relatesTo: [ 0p6Bn8kQ60g ]
---

# Testing Style

Binder uses the Bun test runner. Tests live alongside source files in `__tests__/` directories or as `*.test.ts` files.

### Structure

- One `describe` block per module or logical unit
- Group related cases with nested `describe`
- Use `it` (not `test`) for individual assertions
- Keep test names short and descriptive: what scenario, what outcome

### Principles

- Test behaviour, not implementation details
- Prefer real DB instances (`createTestDb()`) over mocks for integration coverage
- Mock only external I/O (file system, network) — not your own modules
- Each test should be independent and leave no state behind

### Assertions

- Use `expect(...).toEqual(...)` for deep equality
- Use `expect(...).toMatchObject(...)` when only a subset of fields matters
- For async code use `await expect(promise).resolves.toEqual(...)`

### Running Tests

```
bun test                    # all tests
bun test packages/db        # specific package
bun test --watch            # watch mode
```

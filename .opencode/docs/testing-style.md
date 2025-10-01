---
apply: by file patterns
patterns: *.test.ts
---

# Testing Style Guide

- **Framework**: Use Bun test with standard imports
```typescript
import { describe, it, expect } from 'bun:test';
```

- **Mock Data**: MUST use mocks from `@binder/model` for model entities
```typescript
import { mockTaskEntity, mockUserId, mockSpaceId } from "@binder/model/mocks";

// ✅ Good
const entity = { ...mock;TaskEntity, title: "Custom Title" };

// ❌ Bad - Don't create from scratch
const entity = { id: 1, type: "Task" };
```

- **Single top describe**: You must use a single top-level `describe` so it is possible to easily set up for all the tests. 

- **Helper Functions**: Create `check` helpers ONLY for repetitive assertion logic across multiple test cases
```typescript
// ✅ Good - Multiple similar tests
const check = (filters: EntityFilter, expected: RecordEntity[]) => {
  const result = filterEntities(mockEntities, filters);
  expect(result).toEqual(expected);
};

it("filters with equal operator", () => {
  check({ title: { op: "equal", value: "Task 3" } }, [mockEntities[2]]);
});

it("filters with not operator", () => {
  check({ title: { op: "not", value: "Task 1" } }, [mockEntities[1], mockEntities[2]]);
});

// ❌ Bad - Single use case, keep inline
const checkCache = (cache) => expect(cache.size()).toBe(1);
```

- **Mock Functions**: NEVER use a mocking library.
  Always use real implementations with an in-memory database or mockLlmClient.

- **Store Testing**: For tests that use stores, clean up tables and reload seed data in beforeEach for consistent test state
```typescript
beforeEach(async () => {
  await db.delete(instructionExecutionStepsTable);
  await db.delete(instructionExecutionsTable);
  await loadSeedUsers(db);
  await loadSeedSpaces(db);
  mockLlmClient.clearResponses();
});
```

- **Result Types**: Use custom matchers from `@binder/utils/tests` for Result type assertions
```typescript
import "@binder/utils/tests";

const success = throwIfError(result);
expect(result).toBeErr();
expect(result).toEqual(err(createError("instruction-not-found", expect.stringContaining("not found"))));
```

- **LLM Mock Setup**: Queue responses and errors for predictable LLM behavior in tests
```typescript
mockLlmClient.queueContent("Expected response");
mockLlmClient.queueError("API error");
mockLlmClient.clearResponses(); // Clear between tests
```

- **Array Testing**: Avoid using `toHaveLength` - prefer explicit comparisons for clarity and better error messages
```typescript
// ✅ Good - Single element
expect(result).toEqual([mockTaskEntity]);

// ✅ Good - Small arrays (2-3 elements)
expect(result).toEqual([
  mockTaskEntity,
  { ...mockTaskEntity, id: "task-2", title: "Second Task" }
]);

// ✅ Good - Matching specific properties with expect.objectContaining
expect(errors).toEqual([
  expect.objectContaining({
    message: "invalid type: InvalidrecordType",
    namespace: "record",
  }),
  expect.objectContaining({
    message: "invalid type: InvalidConfigType",
    namespace: "config",
  }),
]);

// ✅ Good - Programmatically generated arrays with expect.objectContaining
expect(result).toEqual(items.map((item) =>
    expect.objectContaining(pick(item, ["id", "title", "status"]))
));

// ❌ Bad - Avoid toHaveLength
expect(result).toHaveLength(3);

// ❌ Bad - Too many hardcoded elements
expect(result).toEqual([
  mockTask1, mockTask2, mockTask3, mockTask4,
  mockTask5, mockTask6, mockTask7, mockTask8
]);
```

- **Object Testing**: Use `toEqual`, `toMatchObject`, or `expect.objectContaining` instead of manual property checking
```typescript
// ✅ Good - Exact match for simple objects
expect(result).toEqual({ id: "task-1", title: "My Task", status: "pending" });

// ✅ Good - Partial matching with toMatchObject for checking specific properties in complex objects
expect(result).toMatchObject({
  id: "task-1",
  title: "My Task"
  // Other properties are ignored
});

// ✅ Good - Nested object matching
expect(result).toEqual({
  task: {
    id: "task-1",
    metadata: expect.objectContaining({
      createdBy: "user-1"
    })
  },
  status: "success"
});

// ❌ Bad - Manual property checking
expect(result.id).toBe("task-1");
expect(result.title).toBe("My Task");
expect(result.status).toBe("pending");

// ❌ Bad - Using toMatchObject for simple objects when toEqual would be clearer
expect(result).toMatchObject({ id: "task-1", title: "My Task", status: "pending" });
```

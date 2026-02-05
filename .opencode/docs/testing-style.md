# Testing Style Guide

- **Framework**: Use Bun test with standard imports
```typescript
import { describe, it, expect } from 'bun:test';
```

- **Test Placement**: NEVER blindly add new tests at the end of a file. Always analyze the existing test structure first:
  - Find the most logical location based on the feature/behavior being tested
  - Check if an existing test already covers similar functionality and should be adjusted
  - Group related tests together within appropriate describe blocks

- **Mock Data**: MUST use mocks from `@binder/model` for model entities. Mocks live in `.mock.ts` files. NEVER include data in tests that comes from troubleshooting or debugging sessions.
```typescript
import { mockTaskEntity, mockUserId, mockSpaceId } from "@binder/model/mocks";

// ✅ Good
const entity = { ...mockTaskEntity, title: "Custom Title" };

// ❌ Bad - Don't create from scratch
const entity = { id: 1, type: "Task" };

// ❌ Bad - Don't copy real data from logs/debugging
const entity = { id: "abc123-real-id-from-logs", ... };
```

- **Single top describe**: You must use a single top-level `describe` so it is possible to easily set up for all the tests. 

- **Helper Functions**: Prefer using `check` helpers to encapsulate repetitive act+assert logic. Follow the signature pattern `check(input, expectation, opts?)` where `opts` contains extra configuration for special cases. For shared helpers across multiple describe blocks or files, use descriptive names (e.g. `checkFilterResults`).
```typescript
// ✅ Good - Standard check helper pattern
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

// ✅ Good - With options for special cases
const check = (
  input: ParseInput, 
  expected: ParseResult, 
  opts?: { strict?: boolean; timeout?: number }
) => {
  const result = parse(input, opts);
  expect(result).toEqual(expected);
};

it("parses with strict mode", () => {
  check("input", expectedResult, { strict: true });
});

// ✅ Good - Shared helper with descriptive name
const checkUserPermissions = (user: User, resource: Resource, expected: Permission[]) => {
  const result = getPermissions(user, resource);
  expect(result).toEqual(expected);
};

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

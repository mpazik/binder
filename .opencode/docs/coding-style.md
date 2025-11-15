---
apply: by file patterns
patterns: *.ts
---

# Binder Coding Style

## Code Structure

**No Classes, Only Functions**

```typescript
// ❌ Never
// noinspection JSAnnotator

class UserService {
  constructor(private db: Db) {
  }

  async getUser(id: UserId) {
  }
}

// ✅ Always
export const createUserService = (db: Db): UserService => {
  return {
    getUser: async (id: UserId) => {
      // implementation
    },
  };
};
```

**Function Rules**
- Always prefer arrow functions
- Use `const` declarations for function definitions

```typescript
// ✅ Top-level export
export const processData = (
  input: DataInput,
): Result<ProcessedData, ErrorObject> => {};

// ✅ Object method
export const createProcessor = () => {
  return {
    process: (data: RawData) => {},
  };
};

// ✅ Internal functions
const transform = (items: Item[]) => {
  return items.filter((item) => item.isActive);
};
```

**Early Returns**
- Prefer early returns for guard clauses and error handling
- Omit braces for single-line returns
- Avoid double handling of Results - return directly when possible

```typescript
// ✅ Preferred - early returns without braces
const processUser = (user: User | null): Result<ProcessedUser> => {
  if (!user) return err(createError("user_not_found", "User is null"));
  if (!user.isActive)
    return err(createError("user_inactive", "User is not active"));
  if (user.role !== "admin")
    return err(createError("insufficient_permissions", "Admin role required"));
  if (user.providerFailed)
    return err(createError("provider_error", "Provider call failed", { providerCalled: true }));

  // ... main logic here with happy path
};

// ❌ Avoid - nested conditions
const processUser = (user: User | null): Result<ProcessedUser> => {
  if (user) {
    if (user.isActive) {
      // ... main logic here with happy path
    } else {
      return err({key: "user_inactive", message: "User is not active"});
    }
  } else {
    return err({key: "user_not_found", message: "User is null"});
  }
};

// ✅ Direct return - avoid double handling
return resultToJsonRpcResult(await generateSchema(params));

// ❌ Avoid - redundant error checking and wrapping
const result = resultToJsonRpcResult(await generateSchema(params));
if (isErr(result)) return result;
return ok(result.data);

// ✅ Also good for assertions
const calculateDiscount = (price: number, percentage: number): number => {
  assertGreaterThan(price, 0, "price");
  assertInRange(percentage, 0, 100, "percentage");

  if (percentage === 0) return price;
  if (percentage === 100) return 0;

  return price * (1 - percentage / 100);
};
```

## Naming Conventions

**Files**
- Use `kebab-case`: `user-store.ts`, `oauth-client.ts`

**Types**
- Branded Types: `PascalCase` - `UserId`, `SpaceId`, `EntityId`
- Type Guards: `is*()` pattern - `isUserId()`, `isValidEmail()`

**Functions**
- Factories: `create*()` pattern - `createUserStore()`, `createEntity()`
- Validators: `validate*()` pattern - `validateUserInput()`
- Always use arrow functions with `const` declarations

**Tests**
- Test files: `*.test.ts` - `user-store.test.ts`
- Mock files: `*.mock.ts` - `database.mock.ts`

## Type Safety

**Branded Types**
```typescript
export type UserId = BrandDerived<Uid, "UserId">;
export const createUserId = (): UserId => createUid(7, "u") as UserId;
```

## Error handling

**No Exceptions, Only Results**

- Never use `try-catch` or `throw`
- All fallible operations return `Result<T, E>` or `ResultAsync<T, E>`
- Errors use consistent `ErrorObject`: `{ key, message, data? }`

```typescript
// ✅ Always
import { tryCatch, isErr, createError } from "@binder/utils";

const result = await tryCatch(operation());
if (isErr(result)) return result;

// ❌ Never
try {
  await operation();
} catch (e) {
  throw e;
}
```

**Assertions vs Results**

- **Assertions**: Developer errors, invariants, preconditions
- **Results**: Runtime failures, user input, external operations

```typescript
// Assertions for preconditions
import { assertGreaterThan } from "@binder/utils";

const processEntity = (entity: Entity, index: number) => {
  assertDefined(CONFIG_KEY, "entity CONFIG_KEY");
  assertGreaterThan(index, 0, "entity index");
  // Logic proceeds knowing preconditions are met
};

import { err, ok, type Result, createError } from "@binder/utils";

// Results for runtime validation
const validateUserInput = (input: unknown): Result<UserData> => {
  if (!isValidEmail(input.email))
    return err(createError("invalid_email", "Invalid email format"));

  return ok(input as UserData);
};
```

### Assert Functions Reference

**Basic Assertions**
- `assert(condition, name?)` - General assertion
- `assertDefined(value, name?)` - Ensures non-null/undefined
- `assertOk(result, name?)` - Ensures Result is Ok

**Type Assertions**
- `assertType(value, guard, name?)` - Type validation with guard
- `assertOneOf(value, allowed[], name?)` - Enum/literal validation

**Collection Assertions**
- `assertNotEmpty(array, name?)` - Non-empty array check
- `assertNonBlank(string, name?)` - Non-blank string check

**Numeric Assertions**
- `assertInRange(value, min?, max?, name?)` - Numeric range check
- `assertGreaterThan(value, threshold, name?)` - Greater than comparison
- `assertSmallerThan(value, threshold, name?)` - Less than comparison

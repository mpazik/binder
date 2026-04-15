---
key: code-style
title: Code Style
tags: [ contributing ]
description: Coding conventions and style guidelines for the binder codebase.
relatesTo:
  - testing-style
---

# Code Style

## Conventions

- No classes. Use factory functions that return object literals.
- Use arrow functions with `const` declarations.
- Prefer early returns for guard clauses. Omit braces for single-line returns.
- Return Results directly. Do not store in intermediate variables just to return them.
- When branches share logic with different values, compute the varying value and execute once.
- No `try-catch` or `throw`. All fallible operations return `Result<T, E>`.
- Use assertions for developer errors and invariants. Use Results for runtime failures.
- Use explicit return types on exported functions.
- Prefer `type` over `interface` for object shapes.
- Use `const` by default. `let` only when reassignment is needed.
- Avoid `any`. Use `unknown` with narrowing or define a proper type.

## Code Structure

### Factory Functions

Use factory functions that return object literals. No classes.

```typescript
export const createUserService = (db: Db): UserService => {
  return {
    getUser: async (id: UserId) => {
      // implementation
    },
  };
};
```

### Arrow Functions

Use arrow functions with `const` declarations.

```typescript
// Top-level export
export const processData = (
  input: DataInput,
): Result<ProcessedData, ErrorObject> => {};

// Object method
export const createProcessor = () => {
  return {
    process: (data: RawData) => {},
  };
};

// Internal function
const transform = (items: Item[]) => {
  return items.filter((item) => item.isActive);
};
```

### Early Returns

Prefer early returns for guard clauses and error handling. Omit braces for single-line returns.

```typescript
const processUser = (user: User | null): Result<ProcessedUser> => {
  if (!user) return fail("user-not-found", "User is null");
  if (!user.isActive) return fail("user-inactive", "User is not active");
  if (user.role !== "admin")
    return fail("insufficient-permissions", "Admin role required");

  // main logic here with happy path
};
```

Return Results directly. Do not store in an intermediate variable when the caller just passes it through.

```typescript
return resultToJsonRpcResult(await generateSchema(params));
```

Assertions work as early guards for developer invariants:

```typescript
const calculateDiscount = (price: number, percentage: number): number => {
  assertGreaterThan(price, 0, "price");
  assertInRange(percentage, 0, 100, "percentage");

  if (percentage === 0) return price;
  if (percentage === 100) return 0;

  return price * (1 - percentage / 100);
};
```

### Avoid Duplicate Logic in Branches

When branches share the same logic with different values, compute the varying value and execute once. Do not duplicate the call across branches.

```typescript
const table = namespace === "config" ? configTable : recordTable;
return tryCatch(
  tx.select().from(table).where(buildWhereClause(table, filters, schema)),
);
```

The same applies to function references:

```typescript
const visit = isDirectory ? visitDirectoryNode : visitEntityNode;
return visit(doc.contents, entityType, context);
```

Extract complex conditions to named variables:

```typescript
const useAlternative = checkA && checkB && !checkC;
return fetchFrom(useAlternative ? alternativeSource : defaultSource);
```

### Dependency Injection

Dependencies are passed via a `ctx` object as the first parameter. Rules:

- `ctx` is always the first parameter, domain arguments follow.
- Narrow the type to only the fields the function needs via `Pick<RuntimeContextWithDb, ...>`.
- Name the type `*Ctx` -- module-specific, not generic (`VerifySyncCtx`, not `Services` or `Deps`).
- When fields come from different context layers, merge into a flat type via intersection.
- Call sites may pass a broader object if it is structurally compatible.
- Enforced by `local/require-ctx-for-services` ESLint rule for exported functions with 2+ service parameters.

```typescript
// Standalone function -- called directly, no shared state.
type VerifySyncCtx = Pick<RuntimeContextWithDb, "fs" | "kg">;

export const verifySync = async (
  ctx: VerifySyncCtx,
  dataPath: string,
): ResultAsync<VerifySync> => { /* ... */ };

// Factory object -- multiple methods sharing state (caches, resources).
type EntityCacheCtx = Pick<RuntimeContextWithDb, "log" | "kg" | "db">;

export const createEntityCache = (ctx: EntityCacheCtx): EntityCache => {
  const cache = new Map();
  return {
    get: async (id) => { /* uses ctx.kg, cache */ },
    invalidate: (id) => { cache.delete(id); },
  };
};

// Function factory -- returned function passed to .map(), callbacks, etc.
type MapperCtx = Pick<RuntimeContextWithDb, "kg" | "config">;

export const createEntityMapper = (ctx: MapperCtx) =>
  (entity: RawEntity): MappedEntity => { /* uses ctx from closure */ };
```

## Naming Conventions

**Files**: `kebab-case` -- `user-store.ts`, `oauth-client.ts`

**Types**
- Branded types: `PascalCase` -- `UserId`, `SpaceId`, `EntityId`
- Type guards: `is*()` -- `isUserId()`, `isValidEmail()`

**Functions**
- Factories: `create*()` -- `createUserStore()`, `createEntity()`
- Validators: `validate*()` -- `validateUserInput()`

**Tests**: `*.test.ts`, mocks: `*.mock.ts`

## Type Safety

### Branded Types

Define branded types with a `create*` factory. Each branded type wraps a base type with a unique tag.

```typescript
export type UserId = BrandDerived<Uid, "UserId">;
export const createUserId = (): UserId => createUid(7, "u") as UserId;
```

### General Rules

- Use explicit return types on exported functions
- Prefer `type` over `interface` for object shapes
- Use `const` by default; `let` only when reassignment is needed
- Avoid `any` -- use `unknown` with narrowing or define a proper type

## Error Handling

### No Exceptions, Only Results

No `try-catch` or `throw`. All fallible operations return `Result<T, E>` or `ResultAsync<T, E>`.

Errors use `ErrorObject`:

```typescript
type ErrorObject = {
  key: string;        // static identifier, telemetry-safe, never interpolated
  message: string;    // human-readable, may contain user values
  cause?: ErrorObject; // structured chain replacing string concatenation
  suggestion?: string; // how to fix it
  data?: object;      // optional local-only context
};
```

Every error answers three questions: what failed (message), why (cause chain), and what to do next (suggestion).

**Error keys** are static string literals in kebab-case. Never interpolate runtime values into keys. For telemetry, use `errorChain(error)` to extract the key array from a cause chain.

Wrap external calls that may throw with `tryCatch`:

```typescript
import { tryCatch, isErr } from "@binder/utils";

const result = await tryCatch(operation());
if (isErr(result)) return result;
```

Use `fail()` for early-exit errors:

```typescript
if (!user) return fail("user-not-found", "User not found");
if (!config) return fail("missing-config", "No config file", {
  suggestion: "Run binder init to create a workspace",
});
```

Use `wrapError` to add context when propagating a failure. It sets the original error as `cause` instead of concatenating messages:

```typescript
const configResult = await loadConfig();
if (isErr(configResult)) {
  // Inherits key from original error
  return wrapError(configResult, "Failed to initialize app");
  // Or provide a new key
  return wrapError(configResult, "init-failed", "Failed to initialize app");
}
```

### Avoiding try-catch with Promise Chains

Some Node APIs throw on failure (e.g. `fs/promises`). Use promise combinators instead of try-catch.

For existence checks, use `.then` with two callbacks:

```typescript
const exists = await access(path).then(
  () => true,
  () => false,
);
```

For optional reads with a fallback, use `.catch`:

```typescript
const content = await readFile(path, "utf-8").catch(() => "");
```

For resource cleanup, use `.finally`:

```typescript
const fh = await open(path, "r");
await fh.read(buffer, 0, length, start).finally(() => fh.close());
```

If none of these work and `try/finally` is genuinely needed (no `catch`), add an eslint-disable comment:

```typescript
// eslint-disable-next-line no-restricted-syntax -- try/finally for cleanup, not error handling
try {
  doWork();
} finally {
  releaseResource();
}
```

### Assertions vs Results

Use assertions for developer errors and invariants. These throw on violation and should not be caught.

```typescript
import { assertDefined, assertGreaterThan } from "@binder/utils";

const processEntity = (entity: Entity, index: number) => {
  assertDefined(CONFIG_KEY, "entity CONFIG_KEY");
  assertGreaterThan(index, 0, "entity index");
};
```

Use Results for runtime failures, user input, and external operations:

```typescript
import { fail, ok, type Result } from "@binder/utils";

const validateUserInput = (input: unknown): Result<UserData> => {
  if (!isValidEmail(input.email))
    return fail("invalid-email", "Invalid email format");

  return ok(input as UserData);
};
```

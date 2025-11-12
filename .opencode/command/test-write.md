---
description: Write tests for discussed functionality
agent: build
subtask: false
---

Write tests for the functionality we discussed.

$ARGUMENTS

Write concise, focused tests that validate the success case and most prominent edge/error cases.

Exactly follow tests cases, if specified 

## References
### Result matchers
```ts
declare module "bun:test" {
  interface Matchers<T> {
    toBeOk(): T;
    toBeOkWith(expected: unknown): T;
    toBeErr(): T;
    toBeErrWithKey(errorKey: string): T;
    toBeErrWithMessage(message: string): T;
  }
  interface AsymmetricMatchersContaining {
    toBeOk(): any;
    toBeOkWith(expected: unknown): any;
    toBeErr(): any;
    toBeErrWithKey(errorKey: string): any;
    toBeErrWithMessage(message: string): any;
  }
}
```

### Commonly used Mocks
@packages/db/src/db.mock.ts
@packages/db/src/model/node.mock.ts
@packages/db/src/model/schema.mock.ts

### List of mock files
!`find packages -name "*.mock.ts"`

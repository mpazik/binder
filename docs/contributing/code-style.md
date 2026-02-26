---
key: code-style
tags: [ contributing ]
description: Coding conventions and style guidelines for the binder codebase.
relatesTo: [ 4i8-pf59bTA ]
---

# Code Style

### TypeScript

- Use explicit return types on exported functions
- Prefer `type` over `interface` for object shapes
- Use `const` by default; `let` only when reassignment is needed
- Avoid `any` — use `unknown` with narrowing or define a proper type

### Naming

- Files: `kebab-case.ts`
- Types and classes: `PascalCase`
- Variables and functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` for module-level config; `camelCase` for local constants

### Formatting

Binder uses Biome for formatting and linting. Run `bun check` before committing.

### Imports

- Group: external packages, then internal `@binder/*`, then relative paths
- No barrel re-exports from `index.ts` unless intentional for the public API

### Error Handling

- Throw typed errors with descriptive messages
- Avoid swallowing errors silently — log or propagate
- Use `Result`-style returns in library code where callers need to distinguish success from failure

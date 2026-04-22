---
key: node-compatibility
title: Node Compatibility
tags: [ contributing ]
description: How the codebase supports both Bun (dev/test) and Node.js (production) runtimes.
---

# Node Compatibility

Binder uses Bun for development, testing, and building. The production CLI runs on Node.js 22+.

## Build

```bash
bun run build          # bundle for Node
bun run start          # run under Node
bun run dev            # run under Bun (dev mode)
```

The build step (`packages/cli/build.ts`) uses `Bun.build()` with `target: "node"` to produce a single bundled file at `packages/cli/dist/index.js`. Native dependencies like `better-sqlite3` are marked external.

## Platform-specific modules

When a module needs different implementations for Bun and Node, use the `*.bun.ts` / `*.node.ts` naming convention:

```
packages/repo/src/sqlite.bun.ts    # bun:sqlite + drizzle-orm/bun-sqlite
packages/repo/src/sqlite.node.ts   # better-sqlite3 + drizzle-orm/better-sqlite3
```

**Source code always imports the `.bun.ts` variant.** The build plugin automatically rewires `*.bun.ts` imports to `*.node.ts` at bundle time. No runtime detection, no conditional imports.

### Adding a new platform-specific module

1. Create `foo.bun.ts` with the Bun implementation
2. Create `foo.node.ts` with the Node implementation
3. Both files must export the same public API
4. Import from `./foo.bun.ts` in consuming code

The build plugin handles the rest.

## Testing

Unit and integration tests run under Bun. E2E tests can run against either runtime:

```bash
bun run test           # unit tests (Bun)
bun run test:e2e       # e2e tests against Bun dev runner
bun run test:e2e:node  # build + e2e tests against Node build
```

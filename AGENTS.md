# Binder

Binder is a Local-first knowledge base with bidirectional Markdown sync, editor integration (LSP), MCP server, and CLI.

**Status**: Early development — APIs and data formats may change. Breaking changes are allowed.

## Tech Stack

- **TypeScript everywhere** for type safety and better developer tooling
- **Bun** as runtime, test runner and package manager
- **SQLite** as a database for both local and production
- **Drizzle ORM** for type-safe database operations and migrations
- **Zod** for runtime schema validation
- **VS Code Language Server Protocol** for editor integration and diagnostics
- **Yargs** for CLI argument parsing

## Monorepo Structure

Bun workspaces monorepo with three packages under `packages/`:

- **`@binder/cli`** — Main entry point. Contains the CLI, LSP server, MCP server, Markdown document sync/diffing, schema loading, and validation logic.
- **`@binder/db`** — Core data layer. Knowledge graph engine, entity/relationship storage, transaction processing, changeset computation, filtering.
- **`@binder/utils`** — Shared utilities. Pure helpers for arrays, strings, encoding, error handling etc.

# Binder

Binder is a Local-first knowledge base with bidirectional Markdown sync, editor integration (LSP), MCP server, and CLI.

**Status**: Early development — APIs and data formats may change. Breaking changes are allowed.

## Tech Stack

- **TypeScript everywhere** for type safety and better developer tooling
- **Bun** for development, testing, building, and package management
- **Node.js 22+** as the production runtime (built CLI runs via `node`)
- **SQLite** as a database for both local and production (`bun:sqlite` in dev, `better-sqlite3` in production)
- **Drizzle ORM** for type-safe database operations and migrations
- **Zod** for runtime schema validation
- **VS Code Language Server Protocol** for editor integration and diagnostics
- **Yargs** for CLI argument parsing

## Monorepo Structure

Bun workspaces monorepo with three packages under `packages/`:

- **`@binder.do/cli`** — Main entry point. Contains the CLI, LSP server, MCP server, Markdown document sync/diffing, schema loading, and validation logic.
- **`@binder/repo`** — Knowledge graph engine. Entity/relationship storage, transaction processing, changeset computation, filtering.
- **`@binder/utils`** — Shared utilities. Pure helpers for arrays, strings, encoding, error handling etc.

## Testing

- **Unit tests** — `bun test` runs unit tests under each package's `src/` directory.
- **E2E tests** — `bun test:e2e` runs end-to-end smoke tests under `packages/cli/tests/`. These spin up temporary workspaces, seed data, and exercise CLI, LSP, and MCP workflows against a real runtime.

## Development

### Dev Instance

Two binder instances exist in the project. Use the right one:

- `bun run dev` -- dev instance (`.binder-dev/` data). Use for experimentation, testing, inspecting data.
- The `binder` tool / CLI -- production instance. For reading docs and updating task records.

Dev instance commands:

- `bun run dev init -q` -- initialize empty dev instance (no interactive prompts)
- `bun run dev init -q --blueprint project` -- init with Task + Milestone types and sample data
- `bun run dev init -q --blueprint personal` -- init with PARA schema (Area, Project, Task, Note, Resource) and sample data
- `bun run dev read <key> --format yaml` -- inspect dev data
- `bun run dev search <query>` -- search dev data
- `sqlite3 .binder-dev/data/binder.db` -- direct SQL queries on dev instance

### Temporary Files

Scratch scripts, intermediate outputs, and other throwaway files go in `tmp/` at the project root. It is git-ignored.

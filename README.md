# Binder — Git-Inspired Knowledge Graph for Markdown

Binder is a self-organizing workspace where your documents, tasks, and ideas stay in sync with a structured knowledge graph.
It brings the power of typed data, queries, and automation into plain Markdown — no proprietary editors required.
 
## What it does

- Dynamic Markdown: Documents render live views of your data using {{dataview}} blocks. 
- Two-way sync: Edit your docs or update the graph — Binder keeps both sides consistent. 
- Smart ingestion: Ingest notes, transcripts, or files; Binder extracts entities like Task, Decision, or Project
- Automatic updates: Completing a task or adding a new item instantly updates summaries, changelogs, and roadmaps.

## Under the hood

Built on an immutable transaction chain — every change is versioned and verifiable.

SQLite-backed graph store with typed schemas and queries.

Dynamic directories: auto-generated entity files following configurable templates.

LSP integration for Markdown/YAML validation and real-time feedback.

Designed for local-first workflows, Git-like diffs, and multi-tool compatibility (Neovim, VS Code, etc.).

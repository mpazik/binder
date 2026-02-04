<div align="center">

# Binder
### Knowledge Graph for You and your Agents

A local-first database with bidirectional Markdown sync, editor integration, and programmable interfaces.  
Models information as connected atomic facts with an immutable transaction log.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Work_in_Progress-orange)]()

[Features](#key-features) • [Installation](#installation) • [Usage](#usage) • [Contributing](#contributing)

</div>

---

> [!WARNING]  
> **This project is currently in early development.**  
> Internal data structures, configuration formats, and APIs are subject to breaking changes.  
> **Data loss is possible.** Do not use for critical data without independent backups.

## Overview

**Binder** is a self-organizing workspace where your documents, tasks, and ideas stay in sync with a structured knowledge graph. It brings the power of typed data, queries, and automation into plain Markdown — no proprietary editors required.

Unlike traditional note-taking apps, Binder treats your data as a graph of typed entities, allowing both humans and AI agents to read, write, and reason about your knowledge base effectively.

## Key Features

- **Dynamic Markdown**: Documents render live views of your data using field slots. Embed dynamic lists, task summaries, or relation tables directly in your notes.
- **Two-way Sync**: Edit your docs or update the graph via API — Binder keeps both sides consistent.
- **Agent-Ready**: Built with the **Model Context Protocol (MCP)** in mind, allowing AI agents to navigate and manipulate your knowledge graph reliably.
- **Smart Ingestion**: Turn unstructured notes, transcripts, or files into structured entities like Tasks, Decisions, or Projects.
- **Local-First Architecture**: Your data lives on your machine.
- **LSP Integration**: Real-time validation and feedback for your Markdown and YAML configurations via the Language Server Protocol.

## Under the Hood

Binder is built for robustness and transparency:

- **Immutable Transaction Chain**: Every change is versioned and verifiable in an append-only log (`.binder/transactions.jsonl`).
- **SQLite Index**: A high-performance graph store allows for complex SQL queries and typed schema enforcement.
- **Dynamic Directories**: Entity files are auto-generated and organized following configurable templates.
- **Typed Schemas**: Define your domain model in `.binder/types.yaml` and `.binder/fields.yaml`.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.2+ recommended)

### Installation

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd binder
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

### Usage

Binder is a monorepo containing the core database logic, CLI, and integrations.

To run the development CLI:
```bash
bun run dev
```

To build the CLI for production:
```bash
bun run build
```

To inspect the Model Context Protocol (MCP) server:
```bash
bun run mcp:inspect
```

## Configuration

Binder manages your knowledge graph configuration in the `.binder/` directory:

- `types.yaml`: Define entity types (e.g., Task, Person, Project).
- `fields.yaml`: Define reusable fields and their validation rules.
- `config.yaml`: General workspace settings.

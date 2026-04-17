<div align="center">

<img src="https://raw.githubusercontent.com/mpazik/binder/main/.github/assets/logo.svg" alt="Binder" width="80">

# Binder
### Headless Knowledge Base for You and Your Agents

**Local-first** knowledge base with **bidirectional Markdown sync**. Edit in any coding editor, query via **CLI** and **MCP**, share with AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Work_in_Progress-orange)]()

</div>

---

> [!WARNING]  
> **This project is currently in early development.**  
> Internal data structures, configuration formats, and APIs are subject to breaking changes.  
> **Data loss is possible.** Do not use for critical data without independent backups.

<div align="center">
  <img src="https://assets.binder.do/binder-demo.gif" alt="Binder demo" width="720">
</div>

Binder is a local-first knowledge base built on Markdown files. Define types and fields in a schema. Write entities as Markdown. Query and update via CLI or MCP. Every change syncs automatically.

## Install

```bash
npm install -g @binder.do/cli
```

## Quick Start

```bash
binder init
```

The setup wizard picks a blueprint: a starter schema for common use cases like project management or personal notes.

## CLI

Search and query:

```bash
$ binder search type=Task status=active -f "title,status,priority,partOf(title,status)"
```

```yaml
items:
  - title: Add dark mode support
    status: active
    priority: p2
    partOf:
      title: MVP Release
      status: active
```

Create and update:

```bash
$ binder create Task dark-mode title="Add dark mode support" status=active priority=p2 partOf=mvp-release
$ binder update dark-mode status=complete
```

Pipe to any tool:

```bash
$ binder search type=Task status=active -q | jq '.items[] | .key + ": " + .title'
"setup-auth: Set up authentication"
"fix-layout-bug: Fix layout orientation bug"
```

## AI Agents

Add to `.mcp.json` to connect via MCP:

```json
{
  "mcpServers": {
    "binder": {
      "type": "stdio",
      "command": "binder",
      "args": ["mcp"]
    }
  }
}
```

Load Binder's CLI and schema into your agent's context:

```bash
npx skills add mpazik/binder
```

## More

Full docs, concepts, and examples: [github.com/mpazik/binder](https://github.com/mpazik/binder)

## License

[MIT](https://github.com/mpazik/binder/blob/main/LICENSE) · © 2025 Marek Pazik

---
key: cli-conventions
title: CLI Conventions
tags: [ contributing ]
---

# CLI Conventions

Design rules for the Binder CLI. For the implementation reference (which functions to call, code examples), see [cli-ui-guide](cli-ui-guide.md).

When in doubt, check how git, cargo, gh, and ripgrep handle it.

## Three Audiences

The CLI serves humans at a terminal, agents calling commands through tool use, and scripts in pipelines. Design for humans first. Adapt for the other two through TTY detection and structured output.
- **Humans** need readable output, color, helpful errors, confirmation prompts, and suggestions. They work iteratively.
- **Agents** need structured output, concise help, predictable errors, and no interactive prompts. They work in single-shot commands and pay for every token they ingest.
- **Scripts** need stable output formats, reliable exit codes, clean stdout/stderr separation, and signal handling.

## Commands

Subcommands are lowercase, single words. `create`, `search`, `undo`. Noun-verb grouping where it helps: `transaction import`, `documents lint`. Explicit short aliases (`tx` for `transaction`) are fine.

No implicit abbreviation resolution. Don't let `binder cr` match `create` -- it blocks adding new commands later.

### Positionals vs Flags

One positional type is fine. Two types are suspect. Three is never good. Variable-length positionals of the same type work (`search term1 term2`).

Use positionals for the primary operand. Use flags when meaning is ambiguous without the name.

### Standard Flags

Full-length versions for all flags. Single-letter aliases only for frequently used ones.

| Flag        | Alias | Purpose                                     |
| ----------- | ----- | ------------------------------------------- |
| `--help`    |       | Show help                                   |
| `--version` | `-v`  | Show version                                |
| `--format`  |       | Output format (json, yaml, jsonl, csv, tsv) |
| `--fields`  | `-f`  | Field selection                             |
| `--dry-run` | `-d`  | Preview without applying                    |
| `--yes`     | `-y`  | Skip confirmation                           |
| `--quiet`   | `-q`  | Suppress non-essential output               |
| `--limit`   |       | Cap result count                            |
| `--skip`    |       | Skip first N items                          |
| `--orderBy` | `-o`  | Sort order (prefix with `!` for descending) |

`--` terminates flag parsing. `-` as an operand means stdin.

## stdout vs stderr

stdout is the command's answer. It's what arrives on the other end of a pipe. stderr is everything else.

| Purpose                                                         | Stream                    |
| --------------------------------------------------------------- | ------------------------- |
| Data for piping (file paths, query results, serialized records) | stdout                    |
| Status messages, summaries, decoration                          | stderr                    |
| Errors                                                          | stderr (never suppressed) |

Most commands produce no stdout at all. Success messages, key-value displays, and item lists are status output on stderr. stdout is only for raw data meant for another program.

Mutating commands should output the created/modified entity reference to stdout (for piping) and a human-friendly status message to stderr:

```bash
# stdout: the ref, pipeable
# stderr: "Created Task 'Redesign homepage'"
binder create Task title="Redesign homepage" | xargs binder read
```

## Output Formats

Use `--format` to select. One flag, not separate `--json`, `--yaml` flags.

| Format  | Items | Lists | Notes                                    |
| ------- | ----- | ----- | ---------------------------------------- |
| `json`  | yes   | yes   | Default for non-TTY                      |
| `yaml`  | yes   | yes   |                                          |
| `jsonl` | --    | yes   | One JSON object per line. Pipe-friendly. |
| `csv`   | --    | yes   | Flat list. Headers by default.           |
| `tsv`   | --    | yes   | Flat list. Headers by default.           |

When no `--format` is specified, TTY gets pretty-printed output: colored YAML for single items, a table for lists. Non-TTY gets JSON. Explicit `--format` overrides both.

Flat-list formats (`jsonl`, `csv`, `tsv`) serialize items without the pagination wrapper.

### Tables

The default TTY display for list commands. Not a `--format` option -- it's what you see in a terminal when no format is specified.
- Show default summary columns, not every field. Each type should define which columns appear by default. Default columns should be flat, short values -- not nested objects or long descriptions. `--fields` to override.
- Truncate cell values at a reasonable width. No line wrapping that breaks alignment.
- Single relations show the related entity's key/name as a column value.
- Allow-multiple relations show comma-joined keys, truncated if too wide.
- Column headers by default.
- No borders. Space-aligned columns.

Single-item view (YAML pretty-print) shows all fields. Tables are the summary view.

**Open problem**: how to display expanded sub-fields of allow-multiple relations (e.g. `--fields requires(title,status)`). The parent data is flat but each parent has N children with their own columns. Options include indented sub-tables, detail blocks, or separate tables. Not yet decided -- see the problem record for discussion.

### Managing Output Size

Three dimensions of output can grow large. Each has its own control.

**Many items** (list results): paginate with `--limit` and `--skip`. When truncated, report that more results exist and how to get them.

**Many fields** (wide objects): use `--fields` to select which fields appear. Tables show default summary columns -- flat, short values, not nested objects or long descriptions. Agents use `--fields` to control token cost.

**Long field values** (documents, descriptions): a field can be a full markdown document. In TTY pretty-print, long string values should be truncated to a reasonable number of lines with a trailing `…` and a hint to use `--format yaml` for the full value. Tables show one line with `…` for multi-line strings, `[3 items]` for arrays, `{...}` for nested objects.

Serialization formats (`json`, `yaml`, `csv`, `jsonl`, `tsv`) never truncate values. They produce the complete data. When output exceeds what a consumer can handle (e.g. agent tool output limits), the consumer redirects to a file and reads incrementally. The CLI doesn't need to handle this -- shell redirection covers it.

```bash
binder read my-record --format json > /tmp/record.json
```

### List Pagination Feedback

When results are truncated by a limit, tell the user. Show "More results available. Use --limit or --skip to paginate." when `hasNext` is true. Don't silently drop results.

### Pager

Pipe long output through a pager when stdout is a TTY. Respect `$PAGER`. Fall back to `less -R`. Skip the pager when output is piped or redirected.

## Errors

### Structure

Every error has:
- **Key** (machine-readable): `workspace-not-found`, `type-not-found`
- **Message** (what went wrong): human sentence
- **Suggested fix** (when applicable): what to do about it

```
Error: Unknown type 'Taks'. Did you mean 'Task'?
Run 'binder schema' to see available types.
```

For validation failures, list each field error individually. Group similar errors.

### Typo Suggestions

When the user provides an unknown type, field, or command name, suggest the closest match using edit distance (`findSimilar` from `@binder/utils`). Never silently run the corrected version.

### Exit Codes

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| 0    | Success                                      |
| 1    | Runtime error                                |
| 2    | Usage error (bad arguments, unknown command) |

### No Stack Traces

Don't print stack traces to the terminal. Write debug info to a log file and point the user there.

## Confirmation and Safety

Every mutating command falls into one of three tiers:

**Immediate**: reversible via undo, or trivially recoverable. No confirmation prompt. Offer `--dry-run` when input is complex (files, stdin, batch). Examples: `create`, `update`, `delete`, `undo`, `redo`, `tx import`.

**Protected**: irreversible, history is lost, no recovery path. In TTY: show a preview and prompt for confirmation. In non-TTY: refuse unless `--yes` is passed. Examples: `tx squash`, `tx rehash`, `tx rollback`.

**Severe**: catastrophic and irreversible, total data loss. Require typing the name of the thing being destroyed (`--confirm="workspace-name"`). No shortcut.

Some commands are conditionally protected. `tx repair` is safe when replaying but destructive when dropping transactions. Prompt only in the destructive case.

### --dry-run

Preview mode. Show what would happen without applying. Orthogonal to confirmation -- `--dry-run` is an explicit preview, not a safety gate.

### Idempotency

Prefer idempotent operations. An agent may retry the same command. If the result is already achieved, succeed silently or report "no changes."

## TTY Detection

| Context                    | Format default | Decoration | Prompts                   |
| -------------------------- | -------------- | ---------- | ------------------------- |
| TTY (interactive terminal) | pretty         | on         | available                 |
| Non-TTY (piped, scripted)  | json           | off        | refused (require `--yes`) |

## Input Validation

Validate defensively. Agents hallucinate structurally wrong input with confidence.
- Reject control characters (below ASCII 0x20 except `\n`, `\t`) in string inputs.
- Enforce reasonable length limits on keys, field values, type names.
- Sandbox workspace-scoped paths (verify they resolve within the workspace root). Import/export paths are unrestricted.
- Validate early, at the input boundary.

## Signals

| Signal          | Behavior                                      |
| --------------- | --------------------------------------------- |
| SIGINT (Ctrl-C) | Exit promptly. Clean up resources.            |
| SIGTERM         | Graceful shutdown. Release locks.             |
| SIGPIPE         | Exit silently. No error when piped to `head`. |

## After State Changes

Tell the user what happened (on stderr). Suggest the next command when the workflow isn't obvious. Don't over-suggest -- only when the next step is non-obvious or when the user likely needs to run another command to complete their workflow.

```
Created Task #42 'Redesign homepage'
Run 'binder docs render' to update markdown files.
```

## Styling

### Unicode

**TTY**: Unicode symbols are allowed but used with restraint. The goal is scannability, not decoration. Each symbol earns its place by conveying meaning faster than text would.

Allowed symbols:

| Symbol | Use                         | Why it earns its place                               |
| ------ | --------------------------- | ---------------------------------------------------- |
| `→`    | Value transitions, mappings | Faster to scan than "changed to" in dense changesets |
| `─`    | Dividers                    | Cleaner visual break than dashes                     |
| `…`    | Truncation indicator        | Standard, universally understood                     |

That's the current set. Adding a new symbol requires a reason. "It looks nice" is not a reason. The test: would removing this symbol and using ASCII make the output harder to scan? If no, use ASCII.

Not allowed: emoji (inconsistent width across terminals), box-drawing beyond `─` (fragile alignment), mathematical symbols, Nerd Font icons.

**Non-TTY**: ASCII only. No Unicode symbols. This includes piped output, redirected output, and `--format json/yaml/csv/tsv/jsonl`. Non-TTY output must be safe to process with any tool.

### Color

Red for errors. Green for success. Yellow for warnings. Blue for info. Dim/gray for secondary labels. Don't paint everything.

Disable color when: stdout is not a TTY, `NO_COLOR` is set, `TERM=dumb`. Respect `FORCE_COLOR`.

### Layout

Use consistent helpers for blocks, headings, key-value pairs, lists, dividers. No manual blank-line management with empty `println` calls.

## Help

### --help

With no args: brief overview and command list. With `<command> --help`: description, positionals, options, examples.

Lead with examples. Keep help concise.

### help <topic>

Concept documentation beyond individual commands. Topics cover patterns and workflows:

```
binder help queries       # query syntax
binder help patches       # field=value format
binder help refs          # entity reference formats
```

Embedded in the binary. Paged to the terminal. Primary discovery mechanism for agents.

## Configuration Precedence

1. Flags (highest)
2. Environment variables
3. Workspace config
4. Global config
5. Defaults (lowest)

Respect standard variables: `NO_COLOR`, `FORCE_COLOR`, `TERM`, `PAGER`, `TMPDIR`, `EDITOR`.

## Progress

Print something within 100ms. If an operation takes more than a second, show progress on stderr. Suppress progress when not a TTY.

Use a status line approach: overwrite the current line on stderr with `\r`. This works in any terminal without dependencies. For a sequence of items, show a counter (`Processing 12/47…`). For a single long operation, show a message (`Rendering docs…`). Clear the line before printing final output.

No spinners or animation libraries. A static status line that updates is enough. The key rule: don't be silent for more than a second.

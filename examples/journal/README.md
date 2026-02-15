# Journal

A personal journaling system built on [Binder](../../). Entries are structured as plain-text files with day → week → month → quarter → year hierarchy. Each level rolls up into the next.

## What's in here

| File | Purpose |
|---|---|
| `journal.yaml` | Schema — defines journal types, fields, navigation, and templates |
| `journal.ts` | Main script — opens (or creates) a journal entry in your editor |
| `add-log.ts` | Appends a timestamped log line to today's entry |
| `git-import-logs.ts` | Generates journal logs from git commits using an LLM |
| `setup.sh` | Interactive setup — configures directory, editor, and binder workspace |

## Setup

```sh
./setup.sh
```

This will:
1. Ask where your journal should live (sets `JOURNAL_DIR`)
2. Initialize a binder workspace and copy the schema
3. Detect or ask for your editor (sets `EDITOR`)
4. Write exports to your shell profile

Or configure manually:

```sh
export JOURNAL_DIR="$HOME/journal"
export EDITOR="code $JOURNAL_DIR -g"  # or vim, nvim, zed, etc.

cd $JOURNAL_DIR
binder init --quiet
cp /path/to/journal.yaml .
```

## Usage

```sh
# Open today's journal (creates day → week → month → quarter → year if needed)
journal

# Navigate by granularity
journal w          # this week
journal m          # this month
journal q          # this quarter
journal y          # this year

# Offset with prev/next
journal prev       # yesterday
journal w prev     # last week
journal m next     # next month

# Quick log entry — appends "HH:MM - message" to today
add-log "Fixed the auth bug"
add-log "Lunch with Sara"

# Import git commits as log entries (requires claude or opencode)
git-import-logs              # today
git-import-logs 2026-02-10   # specific date
```

## Schema

Each journal type has a **period** (temporal identifier), **plan**, **log** (day only), and **summary**. Days also track scores (mood, sleep, food, work, fitness) on a 1–10 scale.

```
JournalYear    2026
  └─ JournalQuarter  2026-Q1
       └─ JournalMonth    2026-02
            └─ JournalWeek     2026-W07
                 └─ JournalDay      2026-02-09
```

Entries are linked via `parent`/`children` fields — opening a day shows the week's plan, opening a week shows summaries of its days, and so on.

## Editor notes

Terminal editors (vim, nvim, nano) work out of the box — the script sets `cwd` to `JOURNAL_DIR`.

GUI editors need the workspace path for features like LSP. `setup.sh` detects these and adds the right flags automatically:

| Editor | Command set by setup |
|---|---|
| VS Code / Codium | `code $JOURNAL_DIR -g` |
| Cursor | `cursor $JOURNAL_DIR -g` |
| Zed | `zed $JOURNAL_DIR` |

If your editor isn't listed, you can configure it manually:

```sh
export EDITOR="your-editor $JOURNAL_DIR"
```

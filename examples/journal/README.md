# Journal

A personal journaling system built on [Binder](../../). Entries are structured as plain-text files with day → week → month → quarter → year hierarchy. Each level rolls up into the next.

## What's in here

| File | Purpose |
|---|---|
| `journal.yaml` | Schema — defines journal types, fields, navigation, and templates |
| `journal.ts` | Main script — creates a journal entry if needed and prints its file path |
| `add-log.ts` | Appends a timestamped log line to today's entry |
| `git-import-logs.ts` | Generates journal logs from git commits using an LLM |

## Setup

```sh
# Set your journal directory
export JOURNAL_DIR="$HOME/journal"

# Initialize binder workspace and apply the schema
mkdir -p $JOURNAL_DIR && cd $JOURNAL_DIR
binder init
binder blueprint apply /path/to/journal.yaml

# Add to your shell profile
echo 'export JOURNAL_DIR="$HOME/journal"' >> ~/.zshrc
```

## Usage

The `journal` script prints a file path. Compose it with your editor:

```sh
# Open today's journal
$EDITOR $(journal)

# Navigate by granularity
$EDITOR $(journal w)        # this week
$EDITOR $(journal m)        # this month
$EDITOR $(journal q)        # this quarter
$EDITOR $(journal y)        # this year

# Offset with p(rev) / n(ext)
$EDITOR $(journal p)        # yesterday
$EDITOR $(journal w p)      # last week
$EDITOR $(journal m n)      # next month

# Just get the path
journal w p

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

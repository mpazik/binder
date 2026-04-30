---
name: day-log
description: Quick timestamped log entry — no conversation, just capture.
argument-hint: "<message>"
disable-model-invocation: true
---

Append a timestamped log entry to today's journal. No conversation, no reflection — just capture and confirm.

## Context

Today's key: !`bun scripts/journal.ts d 0 --key`

## Action

1. Take the argument as the log message: `$0`
2. Get the current time as HH:MM
3. Append to today's log: `HH:MM - <message>`

## Output

Run a single command:

```
binder update <today-key> 'log+=HH:MM - <message>'
```

Then confirm with one line: `✓ Logged at HH:MM`

No follow-up questions. No conversation. Just capture and done.

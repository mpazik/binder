---
key: cli-ui-guide
title: CLI UI Guide
tags: [ contributing ]
---

# CLI UI Guide

Implementation reference for CLI output and interaction. Covers the `ui.*` helpers, options, serialization, stdin, and pager utilities.

For design rationale and rules, see [cli-conventions](cli-conventions.md).

## UI Object

Commands receive a `ui` object from the runtime. Created via `createUi()` in `cli/ui.ts`. When `--quiet` is active, chrome methods become no-ops but `error`, `printError`, and `printData` still work.

### stdout (data output)

These write to stdout. Use for data another program would consume.

```typescript
ui.println("some/path.md")        // line to stdout
ui.print("partial")               // no newline
ui.printData(data)                // pretty YAML to stdout (TTY) or JSON (non-TTY)
ui.printData(data, "json")        // explicit format
ui.printData(data, "csv")         // flat formats for lists
```

`printData` with no format argument pretty-prints as colored YAML in TTY, JSON otherwise. With an explicit `--format`, it serializes accordingly.

### stderr (chrome)

These write to stderr. Suppressed by `--quiet`.

```typescript
// Layout
ui.block(() => {                  // blank line before and after
  ui.keyValue("Hash", hash);     // "  Hash: abc123" (dim label, normal value)
  ui.keyValue("Author", author);
});
ui.heading("Section Title");     // blank line before, bold blue text
ui.divider();                    // dim horizontal line (─)
ui.list(["one", "two"]);         // bulleted with "- ", 2-space indent
ui.list(["one", "two"], 4);      // 4-space indent

// Inline key-values (multiple on one line)
ui.keyValuesInline(
  ["Hash", hash],
  ["Author", author],
  ["Created", timestamp],
);

// Messages
ui.success("Created successfully");   // green
ui.warning("Database is behind");     // yellow, "WARNING:" prefix
ui.info("Run 'binder tx repair'");    // blue
ui.danger("This will delete data");   // red

// Errors (never suppressed, even with --quiet)
ui.error("Something went wrong");     // red, "Error:" prefix
ui.printError(errorObject);           // structured error with details
```

### Interaction

```typescript
const answer = await ui.input("Enter value: ");
const confirmed = await ui.confirm("Proceed? (y/n) ");
```

`ui.confirm` returns `false` in quiet mode. For protected commands, use `confirmProtected` from `cli/options.ts` instead (handles TTY/non-TTY logic).

### Transaction Display

```typescript
// With key resolution (UIDs → human-readable keys)
await ui.printTransaction(kg, transaction, "concise");
await ui.printTransactions(kg, transactions, "full");

// Without DB lookup (raw UIDs)
ui.printRawTransaction(transaction, "oneline");
ui.printRawTransactions(transactions, "concise");
```

Transaction formats: `"oneline"`, `"concise"`, `"full"`, `"json"`, `"yaml"`.

## Text Styling

Exported from `cli/ui.ts`. These are TTY-aware -- they return plain strings when color is disabled.

```typescript
import { textDim, textBold, textInfo, textSuccess, textWarn, textErr } from "../cli/ui.ts";

textDim("secondary text")         // gray
textBold("emphasis")              // bold
textInfo("key name")              // bright blue
textInfoBold("heading")           // bright blue + bold
textSuccess("done")               // bright green
textWarn("careful")               // bright yellow
textErr("failed")                 // bright red
textErrBold("Error:")             // bright red + bold
textHighlight("match")            // bright magenta
```

## CLI Options

Reusable option definitions from `cli/options.ts`. Spread into yargs builder.

```typescript
import {
  namespaceOption,
  itemFormatOption,
  listFormatOption,
  fieldsOption,
  orderByOption,
  limitOption,
  skipOption,
  lastOption,
  selectionOptions,    // skip + last + limit combined
  dryRunOption,
  yesOption,
} from "../cli/options.ts";

// In a command builder:
.options({ ...namespaceOption, ...listFormatOption, ...limitOption })
```

### Format Options

- `itemFormatOption` -- for single-item commands. Choices: `json`, `yaml`.
- `listFormatOption` -- for list commands. Choices: `json`, `jsonl`, `yaml`, `csv`, `tsv`.

Both default to `json` when stdout is not a TTY, `undefined` (pretty) otherwise.

### Confirmation Gate

For protected (irreversible) commands:

```typescript
import { confirmProtected, yesOption } from "../cli/options.ts";

// In builder:
.options({ ...yesOption })

// In handler:
const confirmed = await confirmProtected(ui, args, "Drop 3 transactions? (y/n) ");
if (isErr(confirmed)) return confirmed;
if (!confirmed.data) return ok(undefined);
```

This handles: `--yes` skips prompt, TTY prompts the user, non-TTY without `--yes` returns an error.

## Serialization

From `utils/serialize.ts`.

```typescript
import { serialize, flatListFormats } from "../utils/serialize.ts";

serialize(data, "json");    // JSON.stringify with 2-space indent
serialize(data, "jsonl");   // one JSON object per line
serialize(data, "yaml");    // YAML
serialize(data, "csv");     // comma-separated with headers
serialize(data, "tsv");     // tab-separated with headers
```

`flatListFormats` is `["jsonl", "csv", "tsv"]` -- formats that serialize items without a pagination wrapper. Use to decide whether to wrap list output.

## Stdin

From `cli/stdin.ts`.

```typescript
import { isStdinPiped, isInteractive, readStdinAs, readStdinAsArray } from "../cli/stdin.ts";

if (isStdinPiped()) {
  const result = await readStdinAs(MySchema);     // parse as JSON/YAML, validate with Zod
  const items = await readStdinAsArray(ItemSchema); // parse array
}
```

`isStdinPiped()` detects pipes, sockets, and file redirects. `isInteractive()` is true only when stdin is a TTY and not piped.

Stdin and positional arguments are mutually exclusive. Check for conflicts and fail early:

```typescript
if (isStdinPiped() && args.query.length > 0) {
  return fail("conflicting-input", "Cannot combine stdin with positional arguments.");
}
```

## Progress

Not yet implemented. When added, progress should use stderr status lines that overwrite in place with `\r`. See [cli-conventions](cli-conventions.md) for the design rules.

Sketch of the expected API:

```typescript
// Counter for batch operations
ui.progress("Importing", { current: 12, total: 47 });  // "Importing 12/47…"

// Indeterminate status
ui.status("Rendering docs…");

// Clear status line before final output
ui.clearStatus();
```

Suppress when not a TTY. Don't use spinner libraries.

## Pager

From `cli/pager.ts`.

```typescript
import { withPager } from "../cli/pager.ts";

await withPager(() => {
  ui.printData(largeDataset);
});
```

Uses `$PAGER` if set, falls back to `less -R`. Skips paging when not interactive. Falls back to direct output if the pager fails.

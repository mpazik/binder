---
apply: by file patterns
patterns: packages/cli/src/**/*.ts
---

# CLI UI Guide

## Rules

- **No Unicode symbols**: Never use ✓, ✗, ⚠, ℹ, • (accessibility issues, inconsistent rendering)
- **Use `-` for bullets**: Simple hyphen, not `•`
- **No manual spacing**: Use `ui.block()` and `ui.heading()` instead of `ui.println("")`
- **Dim labels, normal values**: `ui.keyValue()` handles this automatically

## Layout Helpers

- **`ui.block(fn)`** - Wrap final output with blank lines (1 before, 1 after)
```typescript
ui.block(() => {
  ui.success("Transaction created successfully");
});
```

- **`ui.heading(text)`** - Section header with blank line before
```typescript
ui.heading("Rolling back 3 transaction(s)");
```

- **`ui.keyValue(key, value)`** - Dim label, normal value, 2-space indent
```typescript
ui.keyValue("Hash", transaction.hash);
// Renders: "  Hash: abc123..."
```

- **`ui.list(items, indent?)`** - Bullet list with `-`
```typescript
ui.list(["item one", "item two"], 4);
```

- **`ui.divider()`** - Subtle horizontal line for major sections

## Message Functions

- **`ui.success(message)`** - Green, no prefix
- **`ui.warning(message)`** - Yellow with "WARNING:" prefix
- **`ui.info(message)`** - Blue
- **`ui.danger(message)`** - Red
- **`ui.error(message)`** - Red with "Error:" prefix

## Patterns

```typescript
// ✅ Command success
ui.block(() => {
  ui.printTransaction(result.data);
});
ui.success("Transaction created successfully");

// ✅ Multiple transactions
ui.heading("Rolling back 3 transaction(s)");
for (const tx of transactions) {
  ui.printTransaction(tx);
  ui.println("");
}

// ✅ Warning with action
ui.block(() => {
  ui.warning("Database is behind by 3 transactions");
  ui.info("Run 'binder tx repair' to apply missing transactions");
});

// ❌ Bad - manual spacing
ui.println("");
ui.success("Done");
ui.println("");

// ❌ Bad - Unicode symbols
ui.success("✓ Transaction created");
ui.warning("⚠ Database out of sync");
```

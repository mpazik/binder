# Investigate

Find the root cause of a bug. Don't fix it.

## Context

Read the full task if you haven't already:

```
binder read <key> --format yaml
```

If `sourceFiles` lists files, read them. Otherwise, search for relevant code starting from the `description` and `module`.

## Instructions

1. **Reproduce.** Use `stepsToReproduce` if present. Otherwise, derive reproduction steps from `description` and `details`. Run the code and confirm the bug exists.

2. **Trace.** Follow the execution path from the reproduction. Read the involved source files. Search for related code with grep/ripgrep. Check recent git history on suspicious files.

3. **Narrow down.** Identify the exact location and condition that causes the bug. Temporary debug output is fine during investigation — note what you added so it can be removed.

4. **Document.** Update the task with your findings:

```
binder update <key> rootCause="..." stepsToReproduce="..." sourceFiles+=path/to/file.ts
```

For `rootCause`, explain **why** the bug happens, not just where. For `sourceFiles`, list all files involved — not just the entry point.

If a fix direction is clear, update `potentialSolution` too.

## Done when

- `rootCause` explains why the bug happens
- `stepsToReproduce` documents how to trigger it
- `sourceFiles` lists the relevant files

## Clean up

Remove any temporary changes you made during investigation (debug prints, scratch files). The goal is findings, not code changes.

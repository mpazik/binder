# Design

Define an implementation-ready contract. The output is the task's `specification` field.

This is a collaborative guide — propose the design and discuss with the user before writing it.

## Context

Read the full task:

```
binder read <key> --format yaml
```

Read files listed in `sourceFiles`. If `sourceFiles` is empty, search for relevant code based on `module` and `description`.

If the task links to other records (`relatesTo`, `requires`, `partOf`), read them for context:

```
binder read <linked-key> --format yaml
```

## Instructions

1. **Understand.** Read the task fields, source code, and linked records. Understand the current state of the code and what needs to change.

2. **Explore.** Identify the key design decisions. If there are multiple viable approaches, present them with tradeoffs. Don't go deep on rejected alternatives — surface them, discuss, move on.

3. **Specify.** Write the specification in this format:

```
## Approach
Short summary of the chosen approach.

## Contracts
- API: new or changed function signatures, endpoints, commands
- Types: new or changed types, interfaces, schemas
- Data: storage, serialization, or format changes
- Behavior: observable changes from the user's perspective

(Use "none" for entries that don't apply.)

## File Plan
- path/to/file — what changes and why

## Validation
- How to verify the implementation is correct (tests, checks, manual exercise)

## Steps
1. Implementation steps in order
```

Keep it concise. Contract-first. No internal helper structure unless it's part of the contract.

4. **Write.** Update the task:

```
binder update <key> specification="..."
```

For multi-line content, use a transaction file (see SKILL.md for format).

## Design values

- Choose the narrowest viable approach
- Define contracts, not internals
- Reuse existing patterns and module boundaries
- Don't expand requirements beyond the task

## Done when

- `specification` has Approach, Contracts, File Plan, Validation, and Steps sections
- The user has agreed to the design

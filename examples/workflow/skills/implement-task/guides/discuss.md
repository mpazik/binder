# Discuss

Work through open questions before implementation. This is a collaborative guide — ask the user before making decisions.

## Context

Read the task and follow its `relatesTo` and `requires` links to find Problem records:

```
binder read <key> --format yaml
```

For each linked Problem, load it with its full deliberation tree:

```
binder read <problem-key> -f "key,title,question,details,status,responses(key,title,description,responses(key,title,argumentType,description))" --format yaml
```

## Two levels of questions

**Formal Problems** — questions that would change the architecture or affect multiple tasks. These get their own Problem record with Options, Arguments, and a Decision.

**Task-scoped questions** — smaller questions specific to this task. Resolve them during discussion and capture as a `## Decisions` section in the task's `details` field:

```
## Decisions
- **Question**: what was asked
  **Answer**: what was decided and why
```

Use judgment: if the question only matters for this task, keep it in-task. If the answer matters to other tasks or future work, make it a formal Problem.

## IBIS methodology

For formal Problems, use four record types:

- **Problem** — a question. Fields: `question`, `details`, `status`.
- **Option** — a candidate answer. Linked to Problem via `respondsTo`.
- **Argument** — evidence for or against an Option. Fields: `argumentType` (pro/con). Linked via `respondsTo`.
- **Decision** — a resolved Problem. Links to chosen Option via `decisionOption` and to the Problem via `decisionProblem`. Fields: `outcome`, `consequences`.

Create records with `binder create`:

```
binder create type=Option title="..." description="..." respondsTo=<problem-key>
binder create type=Argument title="..." description="..." argumentType=pro respondsTo=<option-key>
```

Link new Problems to the task: `binder update <task-key> relatesTo+=<problem-key>`

## Instructions

1. **Understand.** Read each unresolved Problem. Restate the core tension.
2. **Research.** Read source code, documentation, and related records. Search the web if needed. Update Problem `details` with findings.
3. **Generate options.** Propose candidate solutions. Create Option records after agreement.
4. **Argue.** Build pro/con arguments. Evidence-based, specific, falsifiable. Grounded in code, docs, or prior art.
5. **Decide.** Only when the user agrees. Create a Decision record.

## Done when

- All linked Problems with status != complete have been addressed
- Task-scoped questions are captured in `details`
- Formal decisions are recorded as Decision records

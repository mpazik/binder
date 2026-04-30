---
name: period-next-plan
description: Period planning (w/m/q/y) — set goal and plan for the next period.
argument-hint: "[w|m|q|y] [offset]"
disable-model-invocation: true
---

Set up the goal and plan for the target period.

## Context

Offset controls direction: **proactive** (positive or default — planning upcoming periods) or **retroactive** (negative — backfilling a past period's plan). Use actual period dates from entries below — do NOT assume "next" or "current."

Target period with parent and siblings (created if missing): !`G=$0; O=$1; binder read $(bun scripts/journal.ts ${G:-w} ${O:-next} --key) -f "key,goal,plan,parent(key,goal,plan,children(key,goal,plan,achievements,summary,totalScore))" --format yaml`
Previous period: !`G=$0; O=$1; P=$([ "$O" = "next" ] || [ -z "$O" ] && echo 0 || echo $(( O - 1 ))); binder read $(bun scripts/journal.ts ${G:-w} $P --key) -f "goal,plan,achievements,events,summary,totalScore" --format yaml`

## Deliver one message

### 1. Parent context

Show the parent period's goal and plan in 3-5 lines. Frame it as: "Here's what [quarter/month/year] is about."

### 2. Sibling review & carry-forwards

Review the sibling periods (parent's children). For each completed sibling, briefly note what was achieved. For the most recent sibling:

- **Diff plan vs achievements** — list items that were planned but NOT achieved.
- **Flag zombie items** — anything planned in 2+ consecutive siblings but never achieved:
  > "This has been on the plan since [period]. Carry with commitment, or kill it."
- For each unfinished item, recommend: **carry forward**, **defer to parent backlog**, or **drop**.

### 3. Proposed goal

Suggest a goal for the new period, derived from:
- Parent period's goal and plan (what's the next logical chunk?)
- Unfinished items worth carrying from the sibling review
- Any obvious next steps

The goal should be 1-3 lines. Concrete, not aspirational fluff.

> "Does this goal feel right, or would you adjust it?"

### 4. Proposed plan

Suggest a plan — concrete items that serve the goal:
- **Week**: max 6 items
- **Month**: max 5 items (broader strokes)
- **Quarter**: max 4 items (one per month roughly)
- **Year**: max 3-4 themes

Pull from:
- Parent plan (what maps to this period?)
- Carry-forwards from the sibling review
- Logical next steps

Don't include items already achieved in previous siblings. Flag any carry-forward explicitly: "(carry from [sibling key])".

> "What to add, remove, or change?"

## After my response

Correct based on input. Max 1 follow-up, then write.

## Output

Use `binder update` to update the target period's entry (key from context):

1. **`goal`**: the agreed goal
2. **`plan`**: the agreed plan as a plain bullet list — no checkboxes, no status markers
3. **Deferred items**: for any carry-forward item marked "→ parent backlog":
   - Get the parent key from context
   - Append: `binder update <parent-key> 'plan+=<item>'`
   - Items marked "→ drop" are not moved anywhere

Do NOT touch `achievements`, `events`, `summary` — those stay empty until the period is summarized.

## Tone and constraints

- Strategic co-founder energy — help me focus, not overcommit
- Propose first, ask second — I correct what's wrong
- One round of feedback, max 1 follow-up, then write
- No aspirational padding — every plan item should be something I'd actually do
- Carry-forwards are explicit, not silently rolled in
- Zombie items MUST be resolved — carry with commitment, defer, or kill
- Under 5 minutes total

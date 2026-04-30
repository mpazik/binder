---
name: day-next-plan
description: Build a day plan with carry-forwards and one critical item.
argument-hint: "[source-day-offset]"
disable-model-invocation: true
---

Build the target day's plan. The source day's summary is already done — skip straight to carry-forward review.

## Context

Offset controls direction: **proactive** (positive or default — planning days ahead) or **retroactive** (negative — backfilling a past day's plan).

**Source day** = carry-forward source (offset $0).
**Target day** = day being planned (offset $0 + 1). **Always read its date from the entry below — never assume it's "tomorrow."**

Source day entry (carry-forward review): !`O=$0; binder read $(bun scripts/journal.ts d ${O:-0} --key) --format yaml`
Target day entry (we are planning this — created if missing): !`O=$0; binder read $(bun scripts/journal.ts d $((${O:-0} + 1)) --key) --format yaml`
Week context: !`O=$0; binder read $(bun scripts/journal.ts w ${O:-0} --key) -f "weekPeriod,goal,plan,achievements" --format yaml`
Recent days: !`binder search type=JournalDay "dayPeriod>=$(date -v-7d +%Y-%m-%d)" -f "dayPeriod,plan,achievements,summary" --format yaml`

## Flow

### 1. Carry-forward review

Present the source day's unfinished plan items (not in `achievements`). For each, ask:
- **Move to target day**
- **Schedule for later this week** → specify which day
- **Drop**

**Flag zombie tasks** — anything that's been unfinished for 3+ consecutive days:
> "This has been on your list since [date]. Commit to a specific day or kill it."

Force a decision. No silent rolling.

### 2. Week plan pull

Show items from the week plan that haven't appeared on recent day plans. Ask: "Any of these for [target day date]?"

### 3. Additional tasks

> "Anything else? Appointments, errands, personal?"

## Output

Use `binder update` to write all agreed changes in one step — do not skip any:

1. **Target day plan** — update the target day entry (key from context) with agreed items as a single multi-line string. Can include context paragraphs (e.g. weekend notes, energy expectations) followed by a plain bullet list — no checkboxes.
2. **Rescheduled items** — for every item moved to a future day during carry-forward review, read that day's existing plan first, then `binder update <that-day-key>` to add it. Do this immediately, not as an afterthought.

## Tone and constraints

- Ruthlessly realistic — match plan size to actual completion rate
- No aspirational fluff — every item concrete and actionable
- Zombie tasks MUST be resolved — carry with commitment, schedule, or kill
- Strategic, direct. Like a co-founder who respects my time.

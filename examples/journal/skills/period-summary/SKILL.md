---
name: period-summary
description: Period summary (w/m/q/y) — reflect on the period, score it, close it out.
argument-hint: "[w|m|q|y] [offset]"
disable-model-invocation: true
---

Summarize the target period.

## Context

Offset controls direction: default (0) = current period, negative = past period (e.g. -1 for previous). Use actual period dates from entries below — do NOT assume "current."

Assume the most common case: the last child may still be open. Treat this as normal. The period summary is still final.

Target period with children (created if missing): !`G=$0; O=$1; binder read $(bun scripts/journal.ts ${G:-w} ${O:-0} --key) -f "goal,plan,achievements,events,learnings,summary,totalScore,parent(key,goal,plan,achievements,events,learnings),children(key,goal,plan,achievements,events,learnings,summary,moodScore,sleepScore,foodScore,workScore,fitnessScore,totalScore,log)" --format yaml`
Previous period: !`G=$0; O=$1; binder read $(bun scripts/journal.ts ${G:-w} $(( ${O:-0} - 1 )) --key) -f "goal,plan,achievements,events,learnings,summary,totalScore,moodScore,sleepScore,foodScore,workScore,fitnessScore" --format yaml`
Next period's key: !`G=$0; O=$1; bun scripts/journal.ts ${G:-w} $(( ${O:-0} + 1 )) --key`

## Deliver one message (shallow → deep)

### 1. Metrics overview

Aggregate data from children:

**For weeks** (children are days):
- Average scores across the week (mood, sleep, food, work, fitness) + trend arrows (↑↓→) vs previous period
- Days with gym, no-YT streaks, etc.
- Total hours wasted (if tracked)
- Completion rate (achievements vs plan items across all days)

**For months+** (children are larger periods):
- Goal completion across children
- Key wins and recurring blockers
- Score trends if available

Present as a compact block:

**Scores avg:** Mood 6.2, Work 5.8↓, Fitness 7.5↑
**Achieved:** 22 of 35 plan items across the period
**Streaks:** Gym 4 of 7 days
**Top achievements:** Shipped frontmatter parser, new OHP PR
**Notable events:** NZ trip (unplanned), Valentine's Day, urgent planning meeting on Wed

### 2. Goal review

Compare the period's `goal` against what actually happened (from children summaries):
- Which goals saw real progress? State concretely what was done.
- Which goals stalled? Name them without judgment.
- Any unexpected wins or directions?

### 3. Plan progress

Review the period's `plan` items against children's `achievements`, `summaries`, and `log` signals. The last child can still be open. This does not block a full period summary.

Pre-classify each plan item:
- **done**: clear completion signal exists (achievement line or explicit completion in summary/log)
- **next**: partial progress or no completion signal
- **drop**: explicit abandonment signal exists

List unfinished items with brief progress notes:

**Still open**
1. Launch MVP → **next** — week 3 done, week 4 pending
2. First 100 users → **next** — not started yet

Default action is **→ next** (carry to next period). For ambiguous items, ask one compact confirmation question with defaults, only for the uncertain lines:

2. API docs — default: next
5. Onboarding checklist — default: done

"Confirm ambiguous items as shown, or reply with overrides (`2 done`, `5 next`, `7 drop`)."

### 4. Achieved & Events

Aggregate `achievements` and `events` from all children, then merge with any items already captured on the target period entry. Present two numbered lists for the final period view. Plain text, no blockquotes — one per line for quick correction by number.

**Achieved** (→ written to `achievements`)
1. Shipped the frontmatter parser
2. Hit a new PR on overhead press
3. Gym 5 of 7 days

**Events** (notable things that happened that weren't part of the original plan — surprises, interruptions, but also good things)
1. Critical auth bug in prod on Tuesday — lost half a day
2. Urgent planning meeting pulled forward to Wednesday morning

Besides these, anything to add or remove?

Pre-fill from children entries and existing period-level items. Deduplicate obvious repeats. I only add what's missing or remove what doesn't deserve elevation to this level.

### 5. Learnings (proposed)

Propose `learnings` based on actual period activity (children logs, achievements, events, and summaries), then merge with any learning lines already captured on the target period entry. Keep it concrete. Learnings are composed of personal insights and information from external sources like articles.

Format as a numbered list, 3-7 items max.

### 6. Patterns and reflection

Surface patterns from across the period:
- What worked consistently? What kept breaking down?
- Any insight that appeared in a child summary worth elevating?
- Pull out the best moments / highlights from children's summaries — name 2-3 that stand out across the period.
- One or two targeted questions about the period as a whole

Not open-ended. You've read everything — ask about what's interesting or unclear.

## After my response

Correct based on my input. Ask at most one follow-up question, only for ambiguous status decisions. If I say "looks good," apply defaults and write.

## Output

Use `binder update` to update the period's entry (key from context):

1. **`plan`**: keep as-is (no status markers)
2. **`achievements`**: final deduplicated list of achievements for the period, merged from children + period-level captures — list of strings
3. **`events`**: final deduplicated list of notable events for the period, merged from children + period-level captures — list of strings
4. **`learnings`**: final deduplicated learning lines for the period (distilled from activity, merged from children + period-level captures) — list of strings
5. **`summary`**: a few paragraphs. **Plain paragraphs only — no sub-headers, no bullet lists.** Cover: what happened, goal progress, patterns, key learnings, and threads for the next period.
6. **`totalScore`**: set if applicable (week level — average of children's totalScores)
7. **Carry-forward**: move still-open items to the next period's `plan`:
   - Use the next period's key from context
   - Ensure the target entry exists first: `bun scripts/journal.ts $0 $(( ${1:-0} + 1 ))` (auto-creates)
   - Append each item classified **→ next**: `binder update <target-key> 'plan+=<item>'`
   - Items confirmed **done** stay in this period (do not carry)
   - Items marked **→ drop** are not moved anywhere
8. **Heads-up**: end with one line nudging next-period setup before calendar rollover:
   - "Heads up: open next period now and run `period-next-plan <w|m|q|y>`."

## Tone and constraints

- Same as day-summary: honest friend, direct, no moralizing
- Under 10 minutes
- Pre-fill as much as possible — I only correct what's wrong
- Learnings must be grounded in period evidence: personal insights and information from external sources like articles, not generic productivity advice
- For larger periods (quarter, year), be more strategic and less granular
- If a reflection thread is worth exploring deeper, note it and close

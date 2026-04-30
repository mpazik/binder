---
name: day-summary
description: Evening summary — reflect on the day, score it, close it out.
argument-hint: "[day-offset]"
disable-model-invocation: true
---

Read the day's journal entry and close it out in two rounds: first discuss, then score and write.

## Context

Offset controls direction: default (0) = today, negative = past day (e.g. -1 for yesterday).

**Target day** = the day being summarized (offset $0). **Always read its date from the entry below — never assume it's "today."**

Target day entry (we are summarizing this — created if missing): !`O=$0; binder read $(bun scripts/journal.ts d ${O:-0} --key) --format yaml`
Week context: !`O=$0; binder read $(bun scripts/journal.ts w ${O:-0} --key) -f "weekPeriod,goal,plan,achievements" --format yaml`
Extra context: Calendar events, activity dump, and health data are injected automatically by the data-sync extension. Use them if present. Activity dump is background context — not every commit or session is an achievement.
Recent days: !`binder search type=JournalDay "dayPeriod>=$(date -v-7d +%Y-%m-%d)" -f "dayPeriod,plan,achievements,summary,moodScore,sleepScore,foodScore,workScore,fitnessScore,totalScore" --format yaml`

---

## First message — Reflect on the day

After reading the entry, deliver one message. Use plain text throughout — no blockquotes.

### 1. Day summary

Brief bullet points of what happened based on the log and plan. Cover what got done, what didn't, and anything notable.

Note: log entries may be added retroactively — don't infer energy flow or timing patterns from timestamps alone. Ask if the timeline is unclear.

### 2. Reflection

Offer a short inferred read on the day — energy, momentum, patterns vs recent days. Honest, not preachy.

### 3. What's missing?

Numbered list. Call out gaps: things the log doesn't cover, plan items with no mention, anything that feels incomplete. Gaps may mean "not logged yet" rather than "didn't happen" — ask "anything not captured yet?" rather than assuming omission.

### 4. How was it?

Ask how the day felt overall. One or two targeted questions if something specific stands out from the log. Not open-ended therapy — you already know most of the day.

---

## After my response — Propose the update

Once I've responded with corrections, reflections, and answers, deliver the full scored proposal in one message.

### 1. Score suggestions

Based on the log, my responses, and the conversation so far, suggest all scores as a numbered list — one per line for quick correction:

**Scores**

1. Mood: 6
2. Sleep: 7 — up from yesterday's 5, more rest
3. Food: 5 — two ice creams, flagged
4. Work: 7 — solid, 4 tasks done despite the dinner crash
5. Fitness: 8

Scale:

- 1-2: extreme, total disaster (rarely used)
- 3-4: bad day in this area
- 5: slip-ups, not great
- 6: okay, nothing special
- 7: good, solid
- 8-9: very good to excellent
- 10: perfect (rarely used)

Flag any score that stands out vs recent days. One line, no lecture.

### 2. Done, Events & Still open

Based on the log, plan, and conversation, pre-fill three numbered lists:

**Done**

1. Shipped the frontmatter parser
2. Hit a new PR on overhead press

**Events** (unexpected things that happened and required attention — interruptions, surprises, incidents)

1. Critical auth bug in prod — dropped everything for 2h
2. Meeting rescheduled to morning — lost the deep work block

**Still open** (plan items not completed — with progress note if any is apparent)

1. Journaling commands → **next day** — not mentioned in log
2. Add to backlog command → **next day** — saw a branch started, any progress?

Default action is **→ next day**. For each, I can say: **→ [day]** to schedule later, or **→ drop** to kill it.

### 3. Highlight

> "What was the best part of today?"

One line. Could be a win, a moment, a feeling. Weave it into the summary.

### 4. Summary draft

A few short paragraphs in natural journal tone. Plain paragraphs only — no sub-headers, no bullet lists. Cover what happened, wins, and any insights or threads for the next day. Incorporate what came up in the reflection, including the highlight.

---

## After confirmation

I respond with final corrections, score adjustments, and carry-forward decisions. If the reflection opened something interesting, ask **max 2 follow-up questions**. If it goes deeper, wrap up the summary and note it as a thread for tomorrow.

Then write the final output.

## Output

Use `binder update` to update the target day's entry (key from context):

1. **Scores**: set `moodScore`, `sleepScore`, `foodScore`, `workScore`, `fitnessScore`, `totalScore` (totalScore = average, rounded)
2. **`achievements`**: what got done — list of strings
3. **`events`**: notable things that happened that weren't part of the plan — list of strings
4. **`summary`**: the confirmed summary text. **Plain paragraphs only — no sub-headers, no bullet lists.**
5. **`plan`**: DO NOT modify. Plan is set at start of day. Completion is tracked in `achievements` only.
6. **Carry-forward**: do NOT write carry-forwards to other entries. The "Still open" list with dispositions (→ next day, → specific day, → drop) is informational — `day-next-plan` owns all carry-forward writes. This prevents duplicates when both skills run in the same session or independently.

## After writing — Offer next-day planning

Once the summary is written, ask:

> "Want to plan [next day's date]?"

If yes: read `.pi/skills/day-next-plan/SKILL.md` and follow its full flow from step 1.

Reuse context already present in the conversation when available (source day entry, target day entry, week context, recent days). Only run binder context commands for missing pieces.

If no: close the session.

## Tone and constraints

- Discuss first, score later
- Pre-fill as much as possible — I only correct what's wrong
- Under 5 minutes total
- Honest friend, not therapist. Direct, not patronizing.
- Don't moralize about procrastination — track patterns, don't judge them
- If there's a thread worth exploring but we're past 2 follow-ups, note it for tomorrow and close

#!/usr/bin/env bun

// Journal
//
// Opens (or creates) a periodic journal entry in Binder
// and prints the file path to stdout.
// Supports day, week, month, quarter, and year granularities
// with optional prev/next offset navigation.
//
// Usage:
//   journal [granularity] [offset] [--key]
//   journal              → today
//   journal w -1         → previous week
//   journal m +1         → next month
//   journal w --key      → current week (binder key only)
//
// Setup:
//   JOURNAL_DIR   Path to your journal workspace directory (required)
//                 export JOURNAL_DIR="$HOME/my-journal"
//
//   BINDER_CMD    Command to run binder (optional, default: "binder")
//                 export BINDER_CMD="binder"

import { exists } from "fs/promises";

const CWD = process.env.JOURNAL_DIR;
if (!CWD) {
  console.error(
    "JOURNAL_DIR is not set. Export it to your journal workspace directory, e.g.:",
  );
  console.error('  export JOURNAL_DIR="$HOME/my-journal"');
  process.exit(1);
}
if (!(await exists(CWD))) {
  console.error(`JOURNAL_DIR directory does not exist: ${CWD}`);
  process.exit(1);
}
const BINDER: string[] = (process.env.BINDER_CMD || "binder").split(" ");

const GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;
type Granularity = (typeof GRANULARITIES)[number];

const GRANULARITY_ALIASES: Record<string, Granularity> = Object.fromEntries(
  GRANULARITIES.map((g) => [g[0], g]),
) as Record<string, Granularity>;

type Offset = number;

const OFFSET_ALIASES: Record<string, Offset> = {
  p: -1,
  prev: -1,
  previous: -1,
  n: 1,
  next: 1,
  c: 0,
  current: 0,
};

const prefix = (g: Granularity) => `j${g[0]}`;
const typeName = (g: Granularity) =>
  `Journal${g[0].toUpperCase()}${g.slice(1)}`;
const periodFieldName = (g: Granularity) => `${g}Period`;
const parentGranularity = (g: Granularity): Granularity | undefined =>
  GRANULARITIES[GRANULARITIES.indexOf(g) + 1];

const showHelp = () => {
  console.log(`Usage: journal [granularity] [offset] [--key]

Granularity:
  d, day      Day (default)
  w, week     Week
  m, month    Month
  q, quarter  Quarter
  y, year     Year

Offset:
  p, prev, -1   Previous period
  n, next, +1   Next period
  -2, +3, ...   Numeric offset (any integer)

Options:
  --key       Print the binder key instead of the file path

Examples:
  journal           Today (file path)
  journal --key     Today (binder key, e.g. jd-2026-03-25)
  journal -1        Yesterday
  journal w         Current week
  journal w -1      Previous week
  journal m +1      Next month`);
};

const isGranularity = (s: string): s is Granularity =>
  GRANULARITIES.includes(s as Granularity);

const parseOffset = (s: string): Offset | undefined => {
  if (s in OFFSET_ALIASES) return OFFSET_ALIASES[s]!;
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  return undefined;
};

const parseArgs = (
  args: string[],
): { granularity: Granularity; offset: Offset; keyOnly: boolean } | null => {
  // Extract flags before positional parsing
  const positional: string[] = [];
  let keyOnly = false;
  for (const arg of args) {
    if (arg === "--key") {
      keyOnly = true;
    } else {
      positional.push(arg);
    }
  }

  const first = positional[0]?.toLowerCase();

  if (first === "-h" || first === "--help") {
    showHelp();
    return null;
  }

  const second = positional[1]?.toLowerCase();

  const isFirstGranularity =
    first && (GRANULARITY_ALIASES[first] || isGranularity(first));
  const granularity = isFirstGranularity
    ? (GRANULARITY_ALIASES[first] ?? (first as Granularity))
    : "day";
  const offsetArg = isFirstGranularity ? second : first;
  if (offsetArg && parseOffset(offsetArg) === undefined) {
    console.error(`Unknown argument: "${offsetArg}"`);
    showHelp();
    process.exit(1);
  }
  const offset: Offset = offsetArg ? parseOffset(offsetArg)! : 0;

  return { granularity, offset, keyOnly };
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const getWeekNumber = (date: Date): number => {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCDate(1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.round((firstThursday - target.valueOf()) / MS_PER_WEEK);
};

const getWeekYear = (date: Date): number => {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  return target.getUTCFullYear();
};

const getQuarter = (date: Date): number => Math.floor(date.getMonth() / 3) + 1;

const applyOffset = (
  date: Date,
  granularity: Granularity,
  offset: Offset,
): Date => {
  if (offset === 0) return date;
  const result = new Date(date);

  switch (granularity) {
    case "day":
      result.setDate(result.getDate() + offset);
      break;
    case "week":
      result.setDate(result.getDate() + offset * 7);
      break;
    case "month":
      result.setMonth(result.getMonth() + offset);
      break;
    case "quarter":
      result.setMonth(result.getMonth() + offset * 3);
      break;
    case "year":
      result.setFullYear(result.getFullYear() + offset);
      break;
  }
  return result;
};

const formatPeriod = (date: Date, granularity: Granularity): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  switch (granularity) {
    case "day":
      return `${y}-${m}-${d}`;
    case "week":
      return `${getWeekYear(date)}-W${String(getWeekNumber(date)).padStart(2, "0")}`;
    case "month":
      return `${y}-${m}`;
    case "quarter":
      return `${y}-Q${getQuarter(date)}`;
    case "year":
      return `${y}`;
  }
};

const normalizeDate = (date: Date, granularity: Granularity): Date => {
  switch (granularity) {
    case "day":
      return new Date(date);
    case "week": {
      const result = new Date(date);
      const day = result.getDay();
      result.setDate(result.getDate() + ((day === 0 ? -6 : 1) - day));
      return result;
    }
    case "month":
      return new Date(date.getFullYear(), date.getMonth(), 1);
    case "quarter":
      return new Date(date.getFullYear(), (getQuarter(date) - 1) * 3, 1);
    case "year":
      return new Date(date.getFullYear(), 0, 1);
  }
};

const buildKey = (granularity: Granularity, period: string) =>
  `${prefix(granularity)}-${period}`;

type EntitySpec = {
  granularity: Granularity;
  period: string;
  key: string;
  parentKey?: string;
  previousKey?: string;
};

const binder = async (
  args: string[],
  stdin?: string,
): Promise<{ success: boolean; output: string }> => {
  const proc = Bun.spawn([...BINDER, ...args], {
    cwd: CWD,
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin ? new Response(stdin).body : "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { success: exitCode === 0, output: output.trim() || stderr.trim() };
};

const entityExists = async (key: string): Promise<boolean> => {
  const result = await binder(["locate", key]);
  return result.success;
};

const previousPeriodKey = (date: Date, granularity: Granularity): string => {
  const prevDate = applyOffset(
    normalizeDate(date, granularity),
    granularity,
    -1,
  );
  return buildKey(granularity, formatPeriod(prevDate, granularity));
};

const buildEntitySpecs = (
  date: Date,
  granularity: Granularity,
): EntitySpec[] => {
  const specs: EntitySpec[] = [];
  let current: Granularity | undefined = granularity;

  while (current) {
    const normalizedDate = normalizeDate(date, current);
    const period = formatPeriod(normalizedDate, current);
    const key = buildKey(current, period);
    const parent = parentGranularity(current);
    const parentKey = parent
      ? buildKey(parent, formatPeriod(normalizeDate(date, parent), parent))
      : undefined;

    specs.push({ granularity: current, period, key, parentKey });
    current = parent;
  }

  return specs;
};

const findMissingEntities = async (
  targetDate: Date,
  specs: EntitySpec[],
): Promise<EntitySpec[]> => {
  const missing: EntitySpec[] = [];

  for (const spec of specs) {
    if (await entityExists(spec.key)) break;
    missing.push(spec);
  }

  // Resolve previous links for missing entities
  for (const spec of missing) {
    const prevKey = previousPeriodKey(targetDate, spec.granularity);
    if (await entityExists(prevKey)) {
      spec.previousKey = prevKey;
    }
  }

  return missing.reverse();
};

const createEntities = async (specs: EntitySpec[]): Promise<boolean> => {
  if (specs.length === 0) return true;

  const inputs = specs.map((spec) => ({
    type: typeName(spec.granularity),
    key: spec.key,
    [periodFieldName(spec.granularity)]: spec.period,
    ...(spec.parentKey ? { parent: spec.parentKey } : {}),
    ...(spec.previousKey ? { previous: spec.previousKey } : {}),
  }));

  const result = await binder(["create"], JSON.stringify(inputs));
  if (!result.success) {
    console.error(`Failed to create entities: ${result.output}`);
    return false;
  }
  return true;
};

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) process.exit(0);

const { granularity, offset, keyOnly } = parsed;
const targetDate = applyOffset(new Date(), granularity, offset);

const specs = buildEntitySpecs(targetDate, granularity);
const missing = await findMissingEntities(targetDate, specs);

if (!(await createEntities(missing))) process.exit(1);

const key = specs[0]!.key;

if (keyOnly) {
  console.log(key);
  process.exit(0);
}

const locateResult = await binder(["locate", key]);
if (!locateResult.success) {
  console.error(`Failed to locate ${key}: ${locateResult.output}`);
  process.exit(1);
}

const filePath = locateResult.output;
console.log(filePath);

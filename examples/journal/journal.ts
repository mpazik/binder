#!/usr/bin/env bun

// Journal
//
// Opens (or creates) a periodic journal entry in Binder.
// Supports day, week, month, quarter, and year granularities
// with optional prev/next offset navigation.
//
// Usage:
//   journal [granularity] [offset]
//   journal              → today
//   journal w prev       → previous week
//   journal m next       → next month
//
// Setup:
//   JOURNAL_DIR   Path to your journal workspace directory (required)
//                 export JOURNAL_DIR="$HOME/my-journal"
//
//   EDITOR        Editor command to open journal files (default: "code")
//                 The file path is appended to this command.
//                 The script sets cwd to JOURNAL_DIR, which is enough
//                 for terminal editors (vim/neovim LSP workspace detection).
//                 For GUI editors that need an explicit workspace folder:
//                   export EDITOR="code $JOURNAL_DIR -g"
//                   export EDITOR="zed $JOURNAL_DIR"
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

type Offset = "current" | "prev" | "next";

const OFFSET_ALIASES: Record<string, Offset> = {
  p: "prev",
  previous: "prev",
  n: "next",
  c: "current",
};

const prefix = (g: Granularity) => `j${g[0]}`;
const typeName = (g: Granularity) =>
  `Journal${g[0].toUpperCase()}${g.slice(1)}`;
const periodFieldName = (g: Granularity) => `${g}Period`;
const parentGranularity = (g: Granularity): Granularity | undefined =>
  GRANULARITIES[GRANULARITIES.indexOf(g) + 1];

const showHelp = () => {
  console.log(`Usage: journal [granularity] [offset]

Granularity:
  d, day      Day (default)
  w, week     Week
  m, month    Month
  q, quarter  Quarter
  y, year     Year

Offset:
  c, current  Current period (default)
  p, prev     Previous period
  n, next     Next period

Examples:
  journal           Today
  journal prev      Yesterday
  journal w         Current week
  journal w prev    Previous week
  journal m next    Next month`);
};

const isGranularity = (s: string): s is Granularity =>
  GRANULARITIES.includes(s as Granularity);
const isOffset = (s: string): s is Offset =>
  s === "current" || s === "prev" || s === "next";

const parseArgs = (
  args: string[],
): { granularity: Granularity; offset: Offset } | null => {
  const first = args[0]?.toLowerCase();

  if (first === "-h" || first === "--help") {
    showHelp();
    return null;
  }

  const second = args[1]?.toLowerCase();

  const isFirstGranularity =
    first && (GRANULARITY_ALIASES[first] || isGranularity(first));
  const granularity = isFirstGranularity
    ? (GRANULARITY_ALIASES[first] ?? (first as Granularity))
    : "day";
  const offsetArg = isFirstGranularity ? second : first;
  const offset: Offset = offsetArg
    ? (OFFSET_ALIASES[offsetArg] ??
      (isOffset(offsetArg)
        ? offsetArg
        : (() => {
            console.error(`Unknown argument: "${offsetArg}"`);
            showHelp();
            process.exit(1);
          })()))
    : "current";

  return { granularity, offset };
};

const getWeekNumber = (date: Date): number => {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
};

const getWeekYear = (date: Date): number => {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  return target.getFullYear();
};

const getQuarter = (date: Date): number => Math.floor(date.getMonth() / 3) + 1;

const applyOffset = (
  date: Date,
  granularity: Granularity,
  offset: Offset,
): Date => {
  if (offset === "current") return date;
  const delta = offset === "next" ? 1 : -1;
  const result = new Date(date);

  switch (granularity) {
    case "day":
      result.setDate(result.getDate() + delta);
      break;
    case "week":
      result.setDate(result.getDate() + delta * 7);
      break;
    case "month":
      result.setMonth(result.getMonth() + delta);
      break;
    case "quarter":
      result.setMonth(result.getMonth() + delta * 3);
      break;
    case "year":
      result.setFullYear(result.getFullYear() + delta);
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
  specs: EntitySpec[],
): Promise<EntitySpec[]> => {
  const missing: EntitySpec[] = [];

  for (const spec of specs) {
    if (await entityExists(spec.key)) break;
    missing.push(spec);
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

const { granularity, offset } = parsed;
const targetDate = applyOffset(new Date(), granularity, offset);

const specs = buildEntitySpecs(targetDate, granularity);
const missing = await findMissingEntities(specs);

if (!(await createEntities(missing))) process.exit(1);

const key = specs[0].key;
const locateResult = await binder(["locate", key]);
if (!locateResult.success) {
  console.error(`Failed to locate ${key}: ${locateResult.output}`);
  process.exit(1);
}

const filePath = locateResult.output;
const editorArgs = (process.env.EDITOR || "code").split(" ");

Bun.spawn([...editorArgs, filePath], {
  cwd: CWD,
  stdio: ["inherit", "inherit", "inherit"],
});

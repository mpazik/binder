#!/usr/bin/env bun

const BINDER: string[] = ["bun", "dev"];
const LLM_PROVIDER = process.env.LLM_PROVIDER || "claude";
const LLM_MODELS: Record<string, { command: string; args: string[] }> = {
  claude: { command: "claude", args: ["--print"] },
  opencode: { command: "opencode", args: ["--print"] },
};

const GIT_LOG_FORMAT = "%H|%ad|%s";
const GIT_DATE_FORMAT = "short";
const GIT_EXCLUDE_PATTERNS = [/^wip/i, /^fix typo/i, /^merge/i];
const DRY_RUN = process.env.DRY_RUN === "true";
const DEBUG = process.env.DEBUG === "true";

const formatLogForPrompt = (log: string[]): string =>
  log.map((entry) => `  - "${entry}"`).join("\n");

const buildSystemPrompt = (
  targetDate: string,
  commits: string,
  prevLog: string[] | null,
  currentLog: string[] | null,
): string => `You are a journaling assistant. Based on the git commits provided, generate NEW journal log entries.

The log format is:
  HH:MM - Activity description

Rules:
- Use 24-hour time format (HH:MM)
- Extract actual timestamps from commits when available
- Each entry should be a single line starting with HH:MM -
- Group related commits together
- Focus on meaningful work, skip low-value commit messages
- Keep descriptions concise
- Return ONLY NEW entries that don't exist in current day log
- Return entries sorted by time ascending (earliest first)
- Return ONLY the YAML list of strings
- If all commits are already covered by existing log entries, return an empty list

${
  prevLog
    ? `PREVIOUS DAY LOG (for context only):
${formatLogForPrompt(prevLog)}

`
    : ""
}${
  currentLog
    ? `CURRENT DAY LOG (DO NOT return entries that duplicate or overlap with these):
${formatLogForPrompt(currentLog)}

`
    : ""
}GIT COMMITS FOR ${targetDate}:
${commits || "  No commits found for this day"}

Example output format:
  - "09:00 - Started working on feature implementation"
  - "11:30 - Fixed bug in data validation"
  - "14:00 - Code review and merged PR #42"`;

const getDateArg = (): string => {
  const arg = process.argv[2];
  if (arg) return arg;
  const envDate = process.env.DATE;
  if (envDate) return envDate;
  return new Date().toISOString().split("T")[0];
};

const parseDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (date: Date): string => date.toISOString().split("T")[0];

const getPrevDate = (dateStr: string): string => {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() - 1);
  return formatDate(date);
};

const binder = async (
  args: string[],
): Promise<{ success: boolean; output: string }> => {
  const proc = Bun.spawn([...BINDER, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (DEBUG) {
    console.log(`[DEBUG] Binder cmd: ${args.join(" ")}`);
    if (stderr.trim()) console.error(`[DEBUG] Binder stderr: ${stderr}`);
  }

  return { success: exitCode === 0, output: output.trim() || stderr.trim() };
};

const getJournalLog = async (date: string): Promise<string[] | null> => {
  const key = `jd-${date}`;
  const result = await binder(["read", key, "--format", "json"]);

  if (!result.success) return null;

  try {
    const entity = JSON.parse(result.output);
    return entity.log ?? null;
  } catch {
    return null;
  }
};

const git = async (args: string[]): Promise<string> => {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
};

const getGitCommits = async (date: string): Promise<string[]> => {
  const since = `${date}T00:00:00`;
  const until = `${date}T23:59:59`;

  const output = await git([
    "log",
    `--since=${since}`,
    `--until=${until}`,
    `--pretty=format:${GIT_LOG_FORMAT}`,
    `--date=${GIT_DATE_FORMAT}`,
  ]);

  return output.split("\n").filter(Boolean);
};

const getCommitChanges = async (commitHash: string): Promise<string[]> => {
  const output = await git(["show", "--stat", "--format=", commitHash]);
  return output
    .split("\n")
    .filter((line: string) => line.trim().startsWith("| "))
    .map((line: string) => line.replace(/^\|\s*/, "").trim());
};

const formatCommits = async (commits: string[]): Promise<string> => {
  const formatted = await Promise.all(
    commits.map(async (c) => {
      const [hash, date, ...msgParts] = c.split("|");
      const msg = msgParts.join("|").trim();

      if (GIT_EXCLUDE_PATTERNS.some((p) => p.test(msg))) return null;

      const changes = await getCommitChanges(hash);
      return `  - ${date} ${msg}${changes.length > 0 ? `\n    Files: ${changes.join(", ")}` : ""}`;
    }),
  );

  return formatted.filter(Boolean).join("\n");
};

const runLLM = async (prompt: string): Promise<string> => {
  const modelConfig = LLM_MODELS[LLM_PROVIDER];

  if (!modelConfig) {
    throw new Error(`Unknown LLM provider: ${LLM_PROVIDER}`);
  }

  const tempFile = `/tmp/journal-prompt-${Date.now()}.txt`;

  await Bun.write(tempFile, prompt);

  const proc = Bun.spawn([modelConfig.command, ...modelConfig.args], {
    stdin: Bun.file(tempFile),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  await Bun.spawn(["rm", tempFile]).exited;

  if (exitCode !== 0) {
    console.error(`LLM execution failed: ${stderr}`);
    throw new Error("LLM failed");
  }

  return output.trim();
};

const parseTime = (entry: string): number => {
  const match = entry.match(/^(\d{2}):(\d{2})/);
  if (!match) return Infinity;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

const parseLogEntries = (output: string): string[] => {
  const entries: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      const entry = trimmed.slice(1).trim().replace(/^"/, "").replace(/"$/, "");
      entries.push(entry);
    }
  }
  return entries;
};

type InsertMutation = ["insert", string] | ["insert", string, number];

const buildInsertMutations = (
  newEntries: string[],
  existingLog: string[] | null,
): InsertMutation[] => {
  if (!existingLog || existingLog.length === 0) {
    return newEntries.map((entry) => ["insert", entry]);
  }

  const merged = [...existingLog];
  const mutations: InsertMutation[] = [];

  for (const entry of newEntries) {
    const time = parseTime(entry);
    let position = merged.length;
    for (let i = 0; i < merged.length; i++) {
      if (parseTime(merged[i]) > time) {
        position = i;
        break;
      }
    }
    merged.splice(position, 0, entry);
    mutations.push(["insert", entry, position]);
  }

  return mutations;
};

const main = async () => {
  const targetDate = getDateArg();
  if (DEBUG) console.log(`Target Date: ${targetDate}`);

  const commits = await getGitCommits(targetDate);
  if (commits.length === 0) {
    console.log("No commits found for this day.");
    process.exit(0);
  }

  const prevDate = getPrevDate(targetDate);
  const prevLog = await getJournalLog(prevDate);
  const currentLog = await getJournalLog(targetDate);

  if (DEBUG) {
    console.log(`Commits found: ${commits.length}`);
    console.log(`Prev log found: ${!!prevLog}`);
    console.log(`Current log found: ${!!currentLog}`);
  }

  const formattedCommits = await formatCommits(commits);
  const prompt = buildSystemPrompt(
    targetDate,
    formattedCommits,
    prevLog,
    currentLog,
  );

  if (DRY_RUN) {
    console.log("--- PROMPT ---");
    console.log(prompt);
    return;
  }

  try {
    const llmOutput = await runLLM(prompt);

    const logEntries = parseLogEntries(llmOutput);
    if (logEntries.length === 0) {
      console.error("No valid log entries returned from LLM");
      console.error(llmOutput);
      process.exit(1);
    }

    const changeset = {
      $ref: `jd-${targetDate}`,
      log: buildInsertMutations(logEntries, currentLog),
    };

    console.log(JSON.stringify(changeset, null, 2));
  } catch (e) {
    console.error("Error generating log:", e);
    process.exit(1);
  }
};

main();

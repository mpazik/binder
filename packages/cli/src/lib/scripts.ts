import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { extname, join } from "node:path";
import { fail, isErr, ok, type ResultAsync, tryCatch } from "@binder/utils";

export type ScriptEntry = {
  /** Stem of the script filename (basename without extension). */
  name: string;
  /** Absolute path to the script file. */
  path: string;
  /** File extension including leading dot (lowercase). */
  ext: string;
};

export type ScriptConflict = {
  name: string;
  paths: string[];
};

export type DiscoveredScripts = {
  scripts: ScriptEntry[];
  conflicts: ScriptConflict[];
};

const SUPPORTED_EXTS = new Set([".ts", ".js", ".mjs", ".sh"]);

/** Discovers executable scripts under `scriptsDir`. Missing dir → empty result. */
export const discoverScripts = async (
  scriptsDir: string,
): Promise<DiscoveredScripts> => {
  const readResult = await tryCatch(() =>
    readdir(scriptsDir, { withFileTypes: true }),
  );
  if (isErr(readResult)) return { scripts: [], conflicts: [] };

  const byStem = new Map<string, ScriptEntry[]>();
  for (const entry of readResult.data) {
    const ext = extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;
    const stem = entry.name.slice(0, entry.name.length - ext.length);
    if (stem.length === 0) continue;
    const path = join(scriptsDir, entry.name);
    // Follow symlinks so symlinked scripts are picked up. `stat` on a
    // symlink returns the target's stats; broken links throw and are skipped.
    const statResult = await tryCatch(() => stat(path));
    if (isErr(statResult) || !statResult.data.isFile()) continue;
    const arr = byStem.get(stem) ?? [];
    arr.push({ name: stem, path, ext });
    byStem.set(stem, arr);
  }

  const scripts: ScriptEntry[] = [];
  const conflicts: ScriptConflict[] = [];
  for (const [name, entries] of [...byStem.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (entries.length === 1) {
      scripts.push(entries[0]!);
    } else {
      conflicts.push({ name, paths: entries.map((e) => e.path).sort() });
    }
  }
  return { scripts, conflicts };
};

/** Returns the script entry for `name`, or `null` if missing. Conflicts return null. */
export const findScript = async (
  scriptsDir: string,
  name: string,
): Promise<ScriptEntry | null> => {
  const { scripts } = await discoverScripts(scriptsDir);
  return scripts.find((s) => s.name === name) ?? null;
};

const isExecutable = async (path: string): Promise<boolean> =>
  access(path, fsConstants.X_OK).then(
    () => true,
    () => false,
  );

export type RunnerCommand = {
  cmd: string;
  args: string[];
};

/** Resolves the shell command to execute a script based on its extension. */
export const resolveRunner = async (
  entry: ScriptEntry,
): ResultAsync<RunnerCommand> => {
  switch (entry.ext) {
    case ".ts":
      return ok({
        cmd: "node",
        args: ["--experimental-strip-types", entry.path],
      });
    case ".js":
    case ".mjs":
      return ok({ cmd: "node", args: [entry.path] });
    case ".sh":
      if (await isExecutable(entry.path))
        return ok({ cmd: entry.path, args: [] });
      return ok({ cmd: "sh", args: [entry.path] });
    default:
      return fail(
        "unsupported-script",
        `Unsupported script extension: ${entry.ext}`,
        { data: { path: entry.path, ext: entry.ext } },
      );
  }
};

export type RunScriptOptions = {
  entry: ScriptEntry;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
};

/**
 * Spawns the script subprocess with `stdio: "inherit"`. Resolves to the child's
 * exit code (or 1 on signal / spawn failure).
 */
export const runScript = async (opts: RunScriptOptions): Promise<number> => {
  const runnerResult = await resolveRunner(opts.entry);
  if (isErr(runnerResult)) return 1;
  const { cmd, args: runnerArgs } = runnerResult.data;

  return new Promise((resolveExit) => {
    const child = spawn(cmd, [...runnerArgs, ...opts.args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: "inherit",
    });
    child.on("error", () => resolveExit(1));
    child.on("exit", (code, signal) => {
      if (typeof code === "number") return resolveExit(code);
      if (signal) {
        // Shell convention: signal-terminated processes exit with 128 + signo.
        const signals = osConstants.signals as Record<string, number>;
        const signo = signals[signal] ?? 0;
        return resolveExit(128 + signo);
      }
      resolveExit(0);
    });
  });
};

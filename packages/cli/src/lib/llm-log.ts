import { join } from "path";
import { isErr, okVoid, type ResultAsync, wrapError } from "@binder/utils";
import type { FileSystem } from "./filesystem.ts";

export const LLM_LOG_DIR = "logs";
export const LLM_LOG_FILE = "llm.jsonl";

export type LlmLogTokenCounts = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type LlmLogSuccess = {
  ts: string;
  operation: string;
  provider: string;
  model: string;
  tokens: LlmLogTokenCounts;
  cost: { total: number };
  durationMs: number;
  ok: true;
};

export type LlmLogFailure = {
  ts: string;
  operation: string;
  provider: string;
  model: string;
  durationMs: number;
  ok: false;
  error: { key: string; message: string };
};

export type LlmLogEntry = LlmLogSuccess | LlmLogFailure;

const llmLogPath = (binderDir: string): string =>
  join(binderDir, LLM_LOG_DIR, LLM_LOG_FILE);

/**
 * Append one JSONL entry to `<binderDir>/logs/llm.jsonl`. Creates the
 * `logs` directory on first call. Failures bubble up wrapped as
 * `llm-log-write-failed`.
 */
export const appendLlmLog = async (
  fs: FileSystem,
  binderDir: string,
  entry: LlmLogEntry,
): ResultAsync<void> => {
  const dir = join(binderDir, LLM_LOG_DIR);
  if (!(await fs.exists(dir))) {
    const mk = await fs.mkdir(dir, { recursive: true });
    if (isErr(mk))
      return wrapError(
        mk,
        "llm-log-write-failed",
        "Failed to create llm log dir",
        {
          data: { dir },
        },
      );
  }
  const path = llmLogPath(binderDir);
  const result = await fs.appendFile(path, `${JSON.stringify(entry)}\n`);
  if (isErr(result))
    return wrapError(
      result,
      "llm-log-write-failed",
      "Failed to append llm log",
      {
        data: { path },
      },
    );
  return okVoid;
};

export const getLlmLogPath = llmLogPath;

import { spawn } from "bun";

const MAX_OUTPUT_LENGTH = 50000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

export type ExecuteResult = {
  success: boolean;
  output: string;
  exitCode: number;
};

export const executeCommand = async (
  cmd: string[],
  abortSignal?: AbortSignal,
): Promise<ExecuteResult> => {
  const proc = spawn(cmd, {
    cwd: process.cwd(),
    maxBuffer: MAX_OUTPUT_LENGTH,
    signal: abortSignal,
    timeout: DEFAULT_TIMEOUT,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  const truncatedStdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
  const truncatedStderr = stderr.slice(0, MAX_OUTPUT_LENGTH);

  let output = "";
  if (truncatedStdout.trim()) {
    output += truncatedStdout.trim();
  }
  if (truncatedStderr.trim()) {
    output += `${output ? "\n" : ""}Error: ${truncatedStderr.trim()}`;
  }

  return {
    success: proc.exitCode === 0,
    output,
    exitCode: proc.exitCode ?? -1,
  };
};

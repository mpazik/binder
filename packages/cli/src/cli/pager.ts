import { fstatSync } from "node:fs";
import { isErr, resultFallback, tryCatch } from "@binder/utils";

const isStdoutTTY = (): boolean =>
  resultFallback(
    tryCatch(() => fstatSync(1).isCharacterDevice()),
    false,
  );

const findPager = (): string[] | undefined => {
  const pager = process.env.PAGER;
  if (pager !== undefined)
    return pager.length > 0 ? pager.split(/\s+/) : undefined;
  return ["less", "-R"];
};

const captureOutput = (fn: () => void): string => {
  const chunks: string[] = [];
  const originalWrite = Bun.stdout.write.bind(Bun.stdout);
  (Bun.stdout as { write: unknown }).write = (
    data: string | Uint8Array,
  ): Promise<number> => {
    const str =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    chunks.push(str);
    return Promise.resolve(str.length);
  };

  fn();
  Bun.stdout.write = originalWrite;

  return chunks.join("");
};

const spawnPager = async (cmd: string[], output: string): Promise<boolean> => {
  const [bin, ...args] = cmd;
  const result = await tryCatch(async () => {
    const proc = Bun.spawn([bin!, ...args], {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    proc.stdin.write(output);
    proc.stdin.end();
    await proc.exited;
  });
  return !isErr(result);
};

/**
 * Pipe output through a pager (like `less`) when stdout is a TTY.
 * Captures all output from the callback and sends it to the pager.
 * Falls back to direct output if no pager is available or stdout is not a TTY.
 */
export const withPager = async (fn: () => void): Promise<void> => {
  const pagerCmd = isStdoutTTY() ? findPager() : undefined;
  if (!pagerCmd) {
    fn();
    return;
  }

  const output = captureOutput(fn);
  if (output.length === 0) return;

  const paged = await spawnPager(pagerCmd, output);
  if (!paged) Bun.stdout.write(output);
};

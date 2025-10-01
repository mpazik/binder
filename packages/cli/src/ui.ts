import { EOL } from "os";
import * as readline from "node:readline/promises";

export const Style = {
  TEXT_HIGHLIGHT: "\x1b[95m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[95m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
};

export function logo() {
  return Style.TEXT_HIGHLIGHT_BOLD + "BINDER" + EOL + Style.TEXT_NORMAL;
}

export function println(...message: string[]) {
  print(...message);
  Bun.stdout.write(EOL);
}

export function print(...message: string[]) {
  Bun.stdout.write(message.join(" "));
}

export async function input(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return rl.question(prompt);
}

export function error(message: string) {
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message);
}

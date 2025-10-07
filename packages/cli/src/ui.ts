import { EOL } from "os";
import * as readline from "node:readline/promises";
import * as YAML from "yaml";

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

export const logo = () => {
  // prettier-ignore
  const binderCondensed = [
    " ▄▄▄▄▖ ▄▖          ▗▄            ",
    " █▌ ▐█ ▄▖ ▄▖▗▄▖  ▄▄▟█ ▗▄▄▄▖ ▄▖▄▄ ",
    " █▛▀▜▙ █▌ █▛▘▐█ █▌ ▐█ █▙▄▟█ ▐█   ",
    " █▙▄▟▛ █▌ █▌ ▐█ ▜▙▄▟▛ ▜▙▄▄▆ ▐█   ",
  ];

  return Style.TEXT_DIM + binderCondensed.join(EOL) + Style.TEXT_NORMAL;
};

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

export const printData = (data: unknown) => {
  const yamlOutput = YAML.stringify(data, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
  });

  const highlighted = yamlOutput
    .split(EOL)
    .map((line) => {
      const keyMatch = line.match(/^(\s*)([^:\s][^:]*?)(:)(.*)$/);
      if (keyMatch) {
        const [, indent, key, colon, value] = keyMatch;
        return (
          indent + Style.TEXT_INFO + key + Style.TEXT_NORMAL + colon + value
        );
      }
      return line;
    })
    .join(EOL);

  println(highlighted);
};

const getEntityOperation = (changeset: Record<string, any>): string => {
  if ("createdAt" in changeset) {
    const createdAtChange = changeset.createdAt;
    if (createdAtChange.op === "set") {
      if (createdAtChange.previous === undefined) return "created";
      if (createdAtChange.value === undefined) return "deleted";
    }
  }
  return "updated";
};

const getEntityLabel = (changeset: Record<string, any>): string => {
  const type = changeset.type?.value ?? changeset.type?.previous;
  const name = changeset.name?.value ?? changeset.name?.previous;
  const title = changeset.title?.value ?? changeset.title?.previous;

  const label = type ?? name ?? title;
  return label ? ` (${label})` : "";
};

const printEntityChanges = (
  label: string,
  changes: Record<string, Record<string, any>>,
) => {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;

  println(`  ${Style.TEXT_DIM}${label} (${entries.length}):`);
  for (const [uid, changeset] of entries) {
    const operation = getEntityOperation(changeset);
    const entityLabel = getEntityLabel(changeset);
    println(`    • ${uid}${entityLabel} - ${operation}`);
  }
};

export const printTransaction = (transaction: {
  id: number;
  hash: string;
  author: string;
  createdAt: string;
  nodes: Record<string, unknown>;
  configurations: Record<string, unknown>;
}) => {
  println(
    Style.TEXT_INFO_BOLD + `Transaction #${transaction.id}` + Style.TEXT_NORMAL,
  );
  println(
    `  ${Style.TEXT_DIM}Hash:${Style.TEXT_NORMAL} ${transaction.hash.slice(0, 12)}...`,
  );
  println(
    `  ${Style.TEXT_DIM}Author:${Style.TEXT_NORMAL} ${transaction.author}`,
  );
  println(
    `  ${Style.TEXT_DIM}Created:${Style.TEXT_NORMAL} ${transaction.createdAt}`,
  );

  printEntityChanges(
    "Node changes",
    transaction.nodes as Record<string, Record<string, any>>,
  );
  printEntityChanges(
    "Config changes",
    transaction.configurations as Record<string, Record<string, any>>,
  );
};

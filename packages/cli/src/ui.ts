import { EOL } from "os";
import * as readline from "node:readline/promises";
import * as YAML from "yaml";
import {
  type EntitiesChangeset,
  type FieldChangeset,
  type FieldValue,
  normalizeValueChange,
  shortTransactionHash,
  type Transaction,
  type ValueChange,
} from "@binder/db";
import type { ErrorObject } from "@binder/utils";

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

  return (
    Style.TEXT_DIM +
    binderCondensed.map((line) => "\u00A0\u00A0" + line).join(EOL) +
    Style.TEXT_NORMAL
  );
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

  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

export const success = (message: string) => {
  println(Style.TEXT_SUCCESS + message + Style.TEXT_NORMAL);
};

export const warning = (message: string) => {
  println(Style.TEXT_WARNING + "WARNING: " + Style.TEXT_NORMAL + message);
};

export const info = (message: string) => {
  println(Style.TEXT_INFO + message + Style.TEXT_NORMAL);
};

export const danger = (message: string) => {
  println(Style.TEXT_DANGER + message + Style.TEXT_NORMAL);
};

export const divider = () => {
  println(Style.TEXT_DIM + "─".repeat(60) + Style.TEXT_NORMAL);
};

export const heading = (message: string) => {
  println("");
  println(Style.TEXT_INFO_BOLD + message + Style.TEXT_NORMAL);
};

export const block = (fn: () => void) => {
  println("");
  fn();
  println("");
};

export const keyValue = (key: string, value: string) => {
  println(`  ${Style.TEXT_DIM}${key}:${Style.TEXT_NORMAL} ${value}`);
};

export const keyValuesInline = (...pairs: [string, string][]) => {
  const formatted = pairs
    .map(
      ([key, value]) => `${Style.TEXT_DIM}${key}:${Style.TEXT_NORMAL} ${value}`,
    )
    .join("  ");
  println(`  ${formatted}`);
};

export const list = (items: string[], indent: number = 2) => {
  const prefix = " ".repeat(indent);
  for (const item of items) {
    println(`${prefix}- ${item}`);
  }
};

export const confirm = async (prompt: string): Promise<boolean> => {
  const answer = await input(prompt);
  return answer.toLowerCase() === "yes" || answer.toLowerCase() === "y";
};

export const printTransactions = (
  transactions: Transaction[],
  format: TransactionFormat = "concise",
) => {
  for (const tx of transactions) {
    printTransaction(tx, format);
    if (format === "full") println("");
  }
};

export const error = (message: string) => {
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message);
};

export const printError = (error: ErrorObject) => {
  println(
    Style.TEXT_DANGER_BOLD +
      "Error: " +
      Style.TEXT_NORMAL +
      (error.message || error.key),
  );

  const formatValue = (value: unknown, indent: string): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (value === null || value === undefined) return String(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      return (
        "\n" +
        value
          .map((item, i) => {
            const itemStr = formatValue(item, indent + "  ");
            return `${indent}  [${i}] ${itemStr}`;
          })
          .join("\n")
      );
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) return "{}";
      return (
        "\n" +
        entries
          .map(([k, v]) => {
            const valStr = formatValue(v, indent + "  ");
            return `${indent}  ${Style.TEXT_INFO}${k}${Style.TEXT_NORMAL}: ${valStr}`;
          })
          .join("\n")
      );
    }
    return String(value);
  };

  if (
    error.key === "changeset-input-process-failed" &&
    error.data &&
    "errors" in error.data
  ) {
    const errors = (error.data as any).errors as any[];
    if (Array.isArray(errors) && errors.length > 0) {
      println(Style.TEXT_DANGER + "Validation errors:" + Style.TEXT_NORMAL);
      for (const validationError of errors) {
        const message =
          validationError.fieldKey && validationError.message
            ? `Field '${Style.TEXT_INFO}${validationError.fieldKey}${Style.TEXT_NORMAL}': ${validationError.message}`
            : formatValue(validationError, "    ");
        println(`  - ${message}`);
      }
      return;
    }
  }

  println(Style.TEXT_DIM + "Error details:" + Style.TEXT_NORMAL);
  const formatted = formatValue(error.data, "");
  println(formatted);
};

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

const getEntityOperation = (changeset: FieldChangeset): string => {
  if ("type" in changeset) {
    const createdAtChange = normalizeValueChange(changeset.type);
    if (createdAtChange.op === "set") {
      if (createdAtChange.previous === undefined) return "created";
      if (createdAtChange.value === undefined) return "deleted";
    }
  }
  return "updated";
};

const getEntityLabel = (changeset: FieldChangeset): string => {
  const change = normalizeValueChange(
    changeset.type ?? changeset.name ?? changeset.label,
  );
  if (change.op !== "set") return `DUBIOUS CHANGE OPERATOR: '${change.op}'`;
  const label = change.value ?? change.previous;
  return label ? ` (${label})` : "";
};

type EntityChangesFormat = "concise" | "full";

const printEntityChanges = (
  label: string,
  changes: EntitiesChangeset,
  format: EntityChangesFormat = "concise",
) => {
  const entries = Object.entries(changes) as [string, FieldChangeset][];
  if (entries.length === 0) return;

  if (format === "full") println("");
  println(`  ${Style.TEXT_DIM}${label} (${entries.length})`);

  for (const [uid, changeset] of entries) {
    const operation = getEntityOperation(changeset);
    const entityLabel = getEntityLabel(changeset);
    const fields = Object.entries(changeset).filter(
      ([key]) => key !== "createdAt" && key !== "updatedAt",
    ) as [string, FieldValue | ValueChange][];

    if (format === "concise") {
      println(`    - ${uid}${entityLabel} ${operation}`);
    } else {
      println(
        `    ${Style.TEXT_INFO}${uid}${entityLabel}${Style.TEXT_NORMAL} ${operation}`,
      );

      for (const [fieldKey, change] of fields) {
        printFieldChange(fieldKey, normalizeValueChange(change), "      ");
      }
    }
  }
};

export type TransactionFormat = "oneline" | "concise" | "full";
export const printTransaction = (
  transaction: Transaction,
  format: TransactionFormat = "concise",
) => {
  const hash =
    format === "full" ? transaction.hash : shortTransactionHash(transaction);
  const timestamp = new Date(transaction.createdAt).toISOString();

  if (format === "oneline") {
    const nodeCount = Object.keys(transaction.nodes).length;
    const configCount = Object.keys(transaction.configurations).length;

    const nodeText = nodeCount === 1 ? "node" : "nodes";
    const configText = configCount === 1 ? "config" : "configs";

    println(
      `${Style.TEXT_INFO_BOLD}#${transaction.id} ` +
        `${Style.TEXT_DIM}${hash} (${transaction.author})` +
        `${Style.TEXT_NORMAL} ${timestamp} - ${nodeCount} ${nodeText}, ${configCount} ${configText}`,
    );
    return;
  }

  println(
    Style.TEXT_INFO_BOLD + `Transaction #${transaction.id}` + Style.TEXT_NORMAL,
  );
  keyValuesInline(
    ["Hash", hash],
    ["Author", transaction.author],
    ["Created", timestamp],
  );

  printEntityChanges("Node changes", transaction.nodes, format);
  printEntityChanges("Config changes", transaction.configurations, format);
};

const printFieldChange = (
  fieldKey: string,
  change: ValueChange,
  indent: string,
) => {
  if (change.op === "set") {
    const { value, previous } = change;
    if (previous === undefined && value !== undefined) {
      println(
        `${indent}${Style.TEXT_DIM}${fieldKey}:${Style.TEXT_NORMAL} ${formatFieldValue(value)}`,
      );
    } else if (previous !== undefined && value === undefined) {
      println(
        `${indent}${Style.TEXT_DIM}${fieldKey}: ` +
          `${Style.TEXT_DANGER}${formatFieldValue(previous)} → (deleted)${Style.TEXT_NORMAL}`,
      );
    } else {
      println(
        `${indent}${Style.TEXT_DIM}${fieldKey}:${Style.TEXT_NORMAL} ` +
          `${formatFieldValue(previous)} → ${formatFieldValue(value)}`,
      );
    }
  } else if (change.op === "seq") {
    const { mutations } = change;
    println(
      `${indent}${Style.TEXT_DIM}${fieldKey}:${Style.TEXT_NORMAL} list mutations:`,
    );
    for (const mutation of mutations) {
      const [kind, mutValue, position] = mutation;
      const posText =
        position !== undefined ? ` at position ${position}` : " at end";
      const kindStyle =
        kind === "insert" ? Style.TEXT_SUCCESS : Style.TEXT_DANGER;
      println(
        `${indent}  ${kindStyle}[${kind}]${Style.TEXT_NORMAL} ${formatFieldValue(mutValue)}${Style.TEXT_DIM}${posText}${Style.TEXT_NORMAL}`,
      );
    }
  }
};

const formatFieldValue = (value: FieldValue | undefined): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") {
    if (value.length > 50) return `"${value.slice(0, 47)}..."`;
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return `{${Object.keys(value).length} fields}`;
  return String(value);
};

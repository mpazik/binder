import { EOL } from "os";
import * as readline from "node:readline/promises";
import * as YAML from "yaml";
import {
  type EntitiesChangeset,
  type FieldChangeset,
  type FieldValue,
  isClearChange,
  isSeqChange,
  isSetChange,
  normalizeValueChange,
  shortTransactionHash,
  type Transaction,
  type ValueChange,
} from "@binder/db";
import { type ErrorObject, noop, noopAsync } from "@binder/utils";
import { serialize, type SerializeFormat } from "../utils/serialize.ts";

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

const print = (...message: string[]) => {
  Bun.stdout.write(message.join(" "));
};

const println = (...message: string[]) => {
  print(...message);
  Bun.stdout.write(EOL);
};

const input = async (prompt: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
};

const success = (message: string) => {
  println(Style.TEXT_SUCCESS + message + Style.TEXT_NORMAL);
};

const warning = (message: string) => {
  println(Style.TEXT_WARNING + "WARNING: " + Style.TEXT_NORMAL + message);
};

const info = (message: string) => {
  println(Style.TEXT_INFO + message + Style.TEXT_NORMAL);
};

const danger = (message: string) => {
  println(Style.TEXT_DANGER + message + Style.TEXT_NORMAL);
};

const divider = () => {
  println(Style.TEXT_DIM + "─".repeat(60) + Style.TEXT_NORMAL);
};

const heading = (message: string) => {
  println("");
  println(Style.TEXT_INFO_BOLD + message + Style.TEXT_NORMAL);
};

const block = (fn: () => void) => {
  println("");
  fn();
  println("");
};

const keyValue = (key: string, value: string) => {
  println(`  ${Style.TEXT_DIM}${key}:${Style.TEXT_NORMAL} ${value}`);
};

const keyValuesInline = (...pairs: [string, string][]) => {
  const formatted = pairs
    .map(
      ([key, value]) => `${Style.TEXT_DIM}${key}:${Style.TEXT_NORMAL} ${value}`,
    )
    .join("  ");
  println(`  ${formatted}`);
};

const error = (message: string) => {
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message);
};

const printError = (err: ErrorObject) => {
  println(
    Style.TEXT_DANGER_BOLD +
      "Error: " +
      Style.TEXT_NORMAL +
      (err.message || err.key),
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
    err.key === "changeset-input-process-failed" &&
    err.data &&
    "errors" in err.data
  ) {
    const errors = (err.data as any).errors as any[];
    if (Array.isArray(errors) && errors.length > 0) {
      println(Style.TEXT_DANGER + "Validation errors:" + Style.TEXT_NORMAL);
      for (const validationError of errors) {
        const fieldName = validationError.field ?? validationError.fieldKey;
        const message =
          fieldName && validationError.message
            ? `Field '${Style.TEXT_INFO}${fieldName}${Style.TEXT_NORMAL}': ${validationError.message}`
            : formatValue(validationError, "    ");
        println(`  - ${message}`);
      }
      return;
    }
  }

  println(Style.TEXT_DIM + "Error details:" + Style.TEXT_NORMAL);
  const formatted = formatValue(err.data, "");
  println(formatted);
};

const printData = (data: unknown, format?: SerializeFormat) => {
  if (format) {
    println(serialize(data, format));
    return;
  }

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
    const change = normalizeValueChange(changeset.type);
    if (isSetChange(change)) {
      if (change.length === 2) return "created";
      if (isClearChange(change)) return "deleted";
    }
    if (isClearChange(change)) return "deleted";
  }
  return "updated";
};

const getEntityLabel = (changeset: FieldChangeset): string => {
  const change = normalizeValueChange(
    changeset.type ?? changeset.name ?? changeset.label,
  );
  if (!isSetChange(change) && !isClearChange(change))
    return `DUBIOUS CHANGE OPERATOR: '${change[0]}'`;
  const label = change[1];
  return label ? ` (${label})` : "";
};

const printEntityChanges = (
  label: string,
  changes: EntitiesChangeset,
  format: "concise" | "full" = "concise",
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
const printTransaction = (
  transaction: Transaction,
  format: TransactionFormat = "concise",
) => {
  const hash =
    format === "full" ? transaction.hash : shortTransactionHash(transaction);
  const timestamp = new Date(transaction.createdAt).toISOString();

  if (format === "oneline") {
    const recordCount = Object.keys(transaction.records).length;
    const configCount = Object.keys(transaction.configs).length;

    const recordText = recordCount === 1 ? "record" : "records";
    const configText = configCount === 1 ? "config" : "configs";

    println(
      `${Style.TEXT_INFO_BOLD}#${transaction.id} ` +
        `${Style.TEXT_DIM}${hash} (${transaction.author})` +
        `${Style.TEXT_NORMAL} ${timestamp} - ${recordCount} ${recordText}, ${configCount} ${configText}`,
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

  printEntityChanges("Record changes", transaction.records, format);
  printEntityChanges("Config changes", transaction.configs, format);
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

const printFieldChange = (
  fieldKey: string,
  change: ValueChange,
  indent: string,
) => {
  if (isSetChange(change)) {
    const value = change[1];
    const previous = change.length === 3 ? change[2] : undefined;
    if (previous === undefined && value !== undefined) {
      println(
        `${indent}${Style.TEXT_DIM}${fieldKey}:${Style.TEXT_NORMAL} ${formatFieldValue(value)}`,
      );
    } else {
      println(
        `${indent}${Style.TEXT_DIM}${fieldKey}:${Style.TEXT_NORMAL} ` +
          `${formatFieldValue(previous)} → ${formatFieldValue(value)}`,
      );
    }
  } else if (isClearChange(change)) {
    const previous = change[1];
    println(
      `${indent}${Style.TEXT_DIM}${fieldKey}: ` +
        `${Style.TEXT_DANGER}${formatFieldValue(previous)} → (deleted)${Style.TEXT_NORMAL}`,
    );
  } else if (isSeqChange(change)) {
    const mutations = change[1];
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

export type Ui = {
  println(...message: string[]): void;
  print(...message: string[]): void;
  input(prompt: string): Promise<string>;
  success(message: string): void;
  warning(message: string): void;
  info(message: string): void;
  danger(message: string): void;
  divider(): void;
  heading(message: string): void;
  block(fn: () => void): void;
  keyValue(key: string, value: string): void;
  keyValuesInline(...pairs: [string, string][]): void;
  list(items: string[], indent?: number): void;
  confirm(prompt: string): Promise<boolean>;
  printTransactions(
    transactions: Transaction[],
    format?: TransactionFormat,
  ): void;
  error(message: string): void;
  printError(error: ErrorObject): void;
  printData(data: unknown, format?: SerializeFormat): void;
  printTransaction(transaction: Transaction, format?: TransactionFormat): void;
};

export const createUi = (options: { quiet?: boolean } = {}): Ui => {
  const { quiet = false } = options;

  if (quiet) {
    return {
      println: noop,
      print: noop,
      input,
      success: noop,
      warning: noop,
      info: noop,
      danger: noop,
      divider: noop,
      heading: noop,
      block: noop,
      keyValue: noop,
      keyValuesInline: noop,
      list: noop,
      confirm: noopAsync,
      printTransactions: noop,
      error,
      printError,
      printData,
      printTransaction: noop,
    };
  }

  return {
    println,
    print,
    input,
    success,
    warning,
    info,
    danger,
    divider,
    heading,
    block,
    keyValue,
    keyValuesInline,
    list: (items: string[], indent: number = 2) => {
      const prefix = " ".repeat(indent);
      for (const item of items) {
        println(`${prefix}- ${item}`);
      }
    },
    confirm: async (prompt: string): Promise<boolean> => {
      const answer = await input(prompt);
      return answer.toLowerCase() === "yes" || answer.toLowerCase() === "y";
    },
    printTransactions: (
      transactions: Transaction[],
      format: TransactionFormat = "concise",
    ) => {
      for (const tx of transactions) {
        printTransaction(tx, format);
        if (format === "full") println("");
      }
    },
    error,
    printError,
    printData,
    printTransaction,
  };
};

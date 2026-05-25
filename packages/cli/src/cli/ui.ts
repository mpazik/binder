import { EOL } from "os";
import { styleText } from "node:util";
import * as readline from "node:readline/promises";
import * as YAML from "yaml";
import {
  type ChangesetValidationError,
  type EntitiesChangeset,
  type FieldChangeset,
  type FieldValue,
  isClearChange,
  isDiffChange,
  isSeqChange,
  isSetChange,
  type KnowledgeGraph,
  mapChangesetValues,
  normalizeValueChange,
  type RecordsChangeset,
  type RecordUid,
  shortTransactionHash,
  type Transaction,
  type ValueChange,
  isValidUid,
} from "@binder/repo";
import { type ErrorObject, formatError, isErr, noop } from "@binder/utils";
import {
  serialize,
  type SerializeFormat,
  type SerializeItemFormat,
} from "../utils/serialize.ts";
import { isBun, isTest } from "../environment.ts";

// --- Text styling (TTY-aware via node:util styleText) ---
// Bun's styleText ignores NO_COLOR / FORCE_COLOR / TTY — apply our own check there.

const shouldUseColor = (): boolean =>
  !isTest &&
  (!!process.stdout.isTTY || !!process.env.FORCE_COLOR) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const colorize = (
  format: Parameters<typeof styleText>[0],
  s: string,
): string =>
  isBun ? (shouldUseColor() ? styleText(format, s) : s) : styleText(format, s);

export const textDim = (s: string) => colorize("gray", s);
export const textBold = (s: string) => colorize("bold", s);
export const textInfo = (s: string) => colorize("blueBright", s);
export const textInfoBold = (s: string) => colorize(["blueBright", "bold"], s);
export const textSuccess = (s: string) => colorize("greenBright", s);
export const textWarn = (s: string) => colorize("yellowBright", s);
export const textErr = (s: string) => colorize("redBright", s);
export const textErrBold = (s: string) => colorize(["redBright", "bold"], s);
export const textHighlight = (s: string) => colorize("magentaBright", s);

export const logo = () => {
  // prettier-ignore
  const binderLogo = [
    " ▂▄▅▆▆▄▂",
    "▜▛▆▇▁▁▆▜▙    ▄▄▄▄  ▄▖          ▗▄",
    "  ▅▂▀▀▃▆▅▖   █▌ ▐▋ ▄▖ ▄▖▗▄▖  ▄▄▟█ ▗▄▄▄▖ ▄▖▄▄",
    " ▌█▁ ▂▟▂▝█▏  █▛▀▜▙ █▌ █▛▘▐█ █▌ ▐█ █▙▄▟█ ▐█",
    "  ▅▃▂▄▆ ▟▋   █▙▄▟▛ █▌ █▌ ▐█ ▜▙▄▟▛ ▜▙▄▄▆ ▐█",
    "   ▃▆▄▅▂▄",
  ];

  // prettier-ignore
  const inverseMask = [
    "",
    "  xx  x",
    "   x  x",
    " x     x",
    "  xxxxx",
    "   x   xx",
  ];

  const lines = binderLogo.map((line, r) => {
    const mask = inverseMask[r] || "";
    const chars = [...line];
    const maskChars = [...mask];
    let result = "";
    let run = "";
    let runIsInverse = false;
    for (let c = 0; c < chars.length; c++) {
      const inv = maskChars[c] === "x";
      if (inv !== runIsInverse) {
        result += runIsInverse ? colorize("inverse", run) : run;
        run = "";
        runIsInverse = inv;
      }
      run += chars[c];
    }
    result += runIsInverse ? colorize("inverse", run) : run;
    return result;
  });

  return textDim(lines.join(EOL));
};

const print = (...message: string[]) => {
  process.stdout.write(message.join(" "));
};

const println = (...message: string[]) => {
  print(...message);
  process.stdout.write(EOL);
};

const eprint = (...message: string[]) => {
  process.stderr.write(message.join(" "));
};

const eprintln = (...message: string[]) => {
  eprint(...message);
  process.stderr.write(EOL);
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
  eprintln(textSuccess(message));
};

const warning = (message: string) => {
  eprintln(textWarn("WARNING:") + " " + message);
};

const info = (message: string) => {
  eprintln(textInfo(message));
};

const danger = (message: string) => {
  eprintln(textErr(message));
};

const divider = (width = 60) => {
  eprintln(textDim("─".repeat(width)));
};

const heading = (message: string) => {
  eprintln("");
  eprintln(textInfoBold(message));
};

const block = (fn: () => void) => {
  eprintln("");
  fn();
  eprintln("");
};

const keyValue = (key: string, value: string) => {
  eprintln(`  ${textDim(key + ":")} ${value}`);
};

const keyValuesInline = (...pairs: [string, string][]) => {
  const formatted = pairs
    .map(([key, value]) => `${textDim(key + ":")} ${value}`)
    .join("  ");
  eprintln(`  ${formatted}`);
};

const error = (message: string) => {
  eprintln(textErrBold("Error:") + " " + message);
};

const formatValidationErrors = (errors: ChangesetValidationError[]): string =>
  errors
    .map((e) => {
      const field = e.field ? ` ${e.field}` : "";
      return `  [#${e.index}${field}] ${e.message}`;
    })
    .join("\n");

type ErrorPrinter = (error: ErrorObject) => string;

// Walks the cause chain — wrapping (e.g. tx import) pushes `data.errors`
// down into `cause.data.errors`.
const extractValidationErrors = (
  error: ErrorObject,
): ChangesetValidationError[] | undefined => {
  let current: ErrorObject | undefined = error;
  while (current) {
    const errors = (current.data as { errors?: unknown } | undefined)?.errors;
    if (Array.isArray(errors) && errors.length > 0)
      return errors as ChangesetValidationError[];
    current = current.cause;
  }
  return undefined;
};

const printWithValidationErrors: ErrorPrinter = (error) => {
  const errors = extractValidationErrors(error);
  if (!errors) return formatError(error);
  return `${formatError(error)}\n${formatValidationErrors(errors)}`;
};

const errorPrinters: Record<string, ErrorPrinter> = {
  "changeset-input-process-failed": printWithValidationErrors,
};

const printError = (errorObj: ErrorObject) => {
  const printer = errorPrinters[errorObj.key] ?? formatError;
  eprintln(textErrBold(printer(errorObj)));
};

const stripNulls = (_: string, v: unknown) => (v === null ? undefined : v);

const printData = (data: unknown, format?: SerializeFormat) => {
  if (format) {
    println(serialize(data, format));
    return;
  }

  const yamlOutput = YAML.stringify(data, stripNulls, {
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
        return indent + textInfo(key) + colon + value;
      }
      return line;
    })
    .join(EOL);

  println(highlighted);
};

export type TransactionFormat =
  | "oneline"
  | "concise"
  | "full"
  | SerializeItemFormat;

const FIELD_VALUE_MAX = 80;

const formatFieldValueInner = (value: unknown): string => {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return `[${value.map(formatFieldValueInner).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `${k}: ${formatFieldValueInner(v)}`).join(", ")}}`;
  }
  return String(value);
};

const formatFieldValue = (value: FieldValue | undefined): string => {
  const formatted = formatFieldValueInner(value);
  if (formatted.length <= FIELD_VALUE_MAX) return formatted;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).length} fields}`;
  return `${formatted.slice(0, FIELD_VALUE_MAX - 4)}...${formatted.startsWith('"') ? '"' : ""}`;
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
      eprintln(
        `${indent}${textDim(fieldKey + ":")} ${formatFieldValue(value)}`,
      );
    } else {
      eprintln(
        `${indent}${textDim(fieldKey + ":")} ` +
          `${formatFieldValue(previous)} → ${formatFieldValue(value)}`,
      );
    }
  } else if (isClearChange(change)) {
    eprintln(
      `${indent}${textDim(fieldKey + ":")} ` +
        textErr(`${formatFieldValue(change[1])} → (deleted)`),
    );
  } else if (isSeqChange(change)) {
    eprintln(`${indent}${textDim(fieldKey + ":")} list mutations:`);
    for (const mutation of change[1]) {
      const [kind, mutValue, position] = mutation;
      const posText =
        position !== undefined ? ` at position ${position}` : " at end";
      const kindColor = kind === "insert" ? textSuccess : textErr;
      eprintln(
        `${indent}  ${kindColor(`[${kind}]`)} ${formatFieldValue(mutValue)}${textDim(posText)}`,
      );
    }
  } else if (isDiffChange(change)) {
    let inserts = 0;
    let deletes = 0;
    let retains = 0;
    for (const op of change[1]) {
      if (op[0] === "insert") inserts += op[1].length;
      else if (op[0] === "delete") deletes += op[1].length;
      else if (op[0] === "retain") retains += op[1];
    }
    eprintln(
      `${indent}${textDim(fieldKey + ":")} ` +
        textDim(
          `(diff, ${change[1].length} ops: +${inserts} -${deletes} =${retains})`,
        ),
    );
  }
};

const getEntityOperation = (changeset: FieldChangeset): string => {
  if ("type" in changeset) {
    const change = normalizeValueChange(changeset.type);
    if (isSetChange(change)) {
      if (change.length === 2) return "created";
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

  if (format === "full") eprintln("");
  eprintln(`  ${textDim(`${label} (${entries.length})`)}`);

  for (const [uid, changeset] of entries) {
    const operation = getEntityOperation(changeset);
    const entityLabel = getEntityLabel(changeset);

    if (format === "concise") {
      eprintln(`    - ${uid}${entityLabel} ${operation}`);
    } else {
      eprintln(`    ${textInfo(uid + entityLabel)} ${operation}`);

      const fields = Object.entries(changeset).filter(
        ([key]) =>
          key !== "createdAt" &&
          key !== "updatedAt" &&
          key !== "id" &&
          key !== "uid" &&
          key !== "key",
      ) as [string, FieldValue | ValueChange][];
      for (const [fieldKey, change] of fields) {
        printFieldChange(fieldKey, normalizeValueChange(change), "      ");
      }
    }
  }
};

const printTransaction = (
  transaction: Transaction,
  format: TransactionFormat = "concise",
) => {
  if (format === "json" || format === "yaml") {
    printData(transaction, format);
    return;
  }
  const hash = shortTransactionHash(transaction);
  const timestamp = new Date(transaction.createdAt).toISOString();
  const txMessage = transaction.message;

  if (format === "oneline") {
    const recordCount = Object.keys(transaction.records).length;
    const configCount = Object.keys(transaction.configs).length;
    const recordText = recordCount === 1 ? "record" : "records";
    const configText = configCount === 1 ? "config" : "configs";
    const metaParts: string[] = [];
    if (transaction.tags.length > 0)
      metaParts.push(`tags:${transaction.tags.join(",")}`);
    if (txMessage) metaParts.push(txMessage);
    const meta = metaParts.length > 0 ? ` | ${metaParts.join(" | ")}` : "";

    eprintln(
      `${textInfoBold(`#${transaction.id}`)} ` +
        `${textDim(`${hash} (${transaction.author})`)} ` +
        `${timestamp} - ${recordCount} ${recordText}, ${configCount} ${configText}${meta}`,
    );
    return;
  }

  eprintln(textInfoBold(`Transaction #${transaction.id}`));
  keyValuesInline(
    ["Hash", hash],
    ["Author", transaction.author],
    ["Created", timestamp],
  );
  if (txMessage) {
    keyValue("Message", txMessage);
  }
  if (transaction.tags.length > 0) {
    keyValue("Tags", transaction.tags.join(", "));
  }

  printEntityChanges("Record changes", transaction.records, format);
  printEntityChanges("Config changes", transaction.configs, format);
};

/** Builds a UID→key map from changesets and DB lookups. */
const buildUidToKeyMap = async (
  kg: KnowledgeGraph,
  transactions: Transaction[],
): Promise<Map<string, string>> => {
  const uidToKey = new Map<string, string>();
  const referenced = new Set<string>();

  for (const tx of transactions) {
    for (const [uid, changeset] of Object.entries(tx.records)) {
      referenced.add(uid);
      mapChangesetValues(changeset, (v) => {
        if (isValidUid(v)) referenced.add(v);
        return v;
      });
      if (uidToKey.has(uid)) continue;
      const keyChange = changeset.key;
      if (keyChange !== undefined) {
        const normalized = normalizeValueChange(keyChange);
        if (isSetChange(normalized) && typeof normalized[1] === "string") {
          uidToKey.set(uid, normalized[1]);
        }
      }
    }
  }

  const missing = [...referenced].filter((uid) => !uidToKey.has(uid));
  for (const uid of missing) {
    const result = await kg.fetchEntity(uid as RecordUid);
    if (isErr(result)) continue;
    const key = result.data.key;
    if (typeof key === "string") uidToKey.set(uid, key);
  }

  return uidToKey;
};

const remapTransaction = (
  tx: Transaction,
  uidToKey: Map<string, string>,
): Transaction => ({
  ...tx,
  records: Object.fromEntries(
    Object.entries(tx.records).map(([uid, changeset]) => [
      uidToKey.get(uid) ?? uid,
      mapChangesetValues(changeset, (v) =>
        isValidUid(v) ? ((uidToKey.get(v) ?? v) as FieldValue) : v,
      ),
    ]),
  ) as RecordsChangeset,
});

export const resolveTransactionDisplayKey = async (
  kg: KnowledgeGraph,
  transaction: Transaction,
): Promise<Transaction> => {
  const uidToKey = await buildUidToKeyMap(kg, [transaction]);
  return remapTransaction(transaction, uidToKey);
};

export const resolveTransactionDisplayKeys = async (
  kg: KnowledgeGraph,
  transactions: Transaction[],
): Promise<Transaction[]> => {
  const uidToKey = await buildUidToKeyMap(kg, transactions);
  return transactions.map((tx) => remapTransaction(tx, uidToKey));
};

export type Ui = {
  println(...message: string[]): void;
  print(...message: string[]): void;
  input(prompt: string): Promise<string>;
  success(message: string): void;
  warning(message: string): void;
  info(message: string): void;
  danger(message: string): void;
  divider(width?: number): void;
  heading(message: string): void;
  block(fn: () => void): void;
  keyValue(key: string, value: string): void;
  keyValuesInline(...pairs: [string, string][]): void;
  list(items: string[], indent?: number): void;
  confirm(prompt: string): Promise<boolean>;
  printRawTransaction(
    transaction: Transaction,
    format?: TransactionFormat,
  ): void;
  printRawTransactions(
    transactions: Transaction[],
    format?: TransactionFormat,
  ): void;
  printTransaction(
    kg: KnowledgeGraph,
    transaction: Transaction,
    format?: TransactionFormat,
  ): Promise<void>;
  printTransactions(
    kg: KnowledgeGraph,
    transactions: Transaction[],
    format?: TransactionFormat,
  ): Promise<void>;
  error(message: string): void;
  printError(error: ErrorObject): void;
  printData(data: unknown, format?: SerializeFormat): void;
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
      confirm: async () => false,
      printRawTransaction: (transaction, format) => {
        if (format === "json" || format === "yaml")
          printData(transaction, format);
      },
      printRawTransactions: noop,
      printTransaction: async (kg, transaction, format) => {
        if (format === "json" || format === "yaml") {
          const resolved = await resolveTransactionDisplayKey(kg, transaction);
          printData(resolved, format);
        }
      },
      printTransactions: async (kg, transactions, format) => {
        if (format === "json" || format === "yaml") {
          const resolved = await resolveTransactionDisplayKeys(
            kg,
            transactions,
          );
          for (const tx of resolved) printData(tx, format);
        }
      },
      error,
      printError,
      printData,
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
        eprintln(`${prefix}- ${item}`);
      }
    },
    confirm: async (prompt: string): Promise<boolean> => {
      const answer = (await input(prompt)).toLowerCase();
      return answer === "yes" || answer === "y";
    },
    printRawTransaction: printTransaction,
    printRawTransactions: (
      transactions: Transaction[],
      format: TransactionFormat = "concise",
    ) => {
      for (const tx of transactions) {
        printTransaction(tx, format);
        if (format === "full") eprintln("");
      }
    },
    printTransaction: async (kg, transaction, format) => {
      const resolved = await resolveTransactionDisplayKey(kg, transaction);
      printTransaction(resolved, format);
    },
    printTransactions: async (kg, transactions, format = "concise") => {
      const resolved = await resolveTransactionDisplayKeys(kg, transactions);
      for (const tx of resolved) {
        printTransaction(tx, format);
        if (format === "full") eprintln("");
      }
    },
    error,
    printError,
    printData,
  };
};

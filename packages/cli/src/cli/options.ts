import {
  type Includes,
  type NamespaceEditable,
  namespacesEditable,
  parseSerialIncludes,
  parseSerialOrderBy,
} from "@binder/repo";
import { fail, ok, throwIfError, type Result } from "@binder/utils";
import type { Argv } from "yargs";
import { serializeFormats, serializeItemFormats } from "../utils/serialize.ts";
import { isInteractive } from "./stdin.ts";
import type { Ui } from "./ui.ts";

// --- Namespace option ---

export const namespaceOption = {
  namespace: {
    alias: "n",
    describe: "namespace",
    choices: namespacesEditable,
    default: "record" as NamespaceEditable,
  },
} as const;

// --- Format options ---

/** Default to JSON when piped (non-TTY), otherwise let the UI decide. */
const nonTtyDefault = process.stdout.isTTY ? undefined : "json";

export const itemFormatOption = {
  format: {
    describe: "output format",
    type: "string",
    choices: serializeItemFormats,
    default: nonTtyDefault,
  },
} as const;

export const listFormatOption = {
  format: {
    describe: "output format",
    type: "string",
    choices: serializeFormats,
    default: nonTtyDefault,
  },
} as const;

/**
 * Offer on commands with complex or external input (files, stdin, batch).
 * Preview mode: show what would happen without applying.
 * Orthogonal to confirmation — this is an explicit preview, not a safety gate.
 */
export const dryRunOption = {
  "dry-run": {
    alias: "d",
    describe: "preview changes without applying",
    type: "boolean",
    default: false,
  },
} as const;

/**
 * Only for protected (irreversible) commands — those that destroy history or
 * data that cannot be recovered via undo (e.g. tx squash, tx rehash).
 *
 * In TTY: skips the interactive confirmation prompt.
 * In non-TTY: required, otherwise the command refuses to run.
 *
 * Do NOT add to immediate (reversible) commands. Those should just apply.
 * See docs/contributing/cli-ui-guide.md for the full policy.
 */
export const yesOption = {
  yes: {
    alias: "y",
    describe: "skip confirmation prompts",
    type: "boolean",
    default: false,
  },
} as const;

/**
 * Confirmation gate for protected (irreversible) commands.
 * - --yes passed: skip prompt, proceed.
 * - TTY: show prompt, let user decide.
 * - Non-TTY without --yes: refuse with error.
 */
export const confirmProtected = async (
  ui: Ui,
  args: { yes?: boolean },
  prompt: string,
): Promise<Result<boolean>> => {
  if (args.yes) return ok(true);
  if (isInteractive()) {
    return ok(await ui.confirm(prompt));
  }
  return fail(
    "confirmation-required",
    "This operation is irreversible. Pass --yes to confirm in non-interactive mode.",
  );
};

export const limitOption = {
  limit: {
    describe: "maximum number of items",
    type: "number",
  },
} as const;

export const lastOption = {
  last: {
    describe: "take last N items",
    type: "number",
  },
} as const;

export const skipOption = {
  skip: {
    describe: "skip first N items",
    type: "number",
  },
} as const;

export const selectionOptions = {
  ...skipOption,
  ...lastOption,
  ...limitOption,
} as const;

export type SelectionArgs = {
  limit?: number;
  last?: number;
  skip?: number;
};

// --- Parsing helpers ---

/**
 * Parse CLI values that may be passed either as repeated args
 * (`--x a --x b`) or as comma-delimited strings (`--x a,b`).
 */
export const parseCommaSeparatedList = <T extends string = string>(
  value: string | string[] | undefined,
): T[] => {
  if (value === undefined) return [];
  const items = (Array.isArray(value) ? value : [value])
    .filter((item): item is string => item !== undefined)
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item): item is T => item.length > 0);
  return [...new Set(items)];
};

export const fieldsOption = {
  fields: {
    alias: "f",
    describe:
      "fields to include (e.g. project(title,status),tags or relatesTo[type=Task](title))",
    type: "string",
    coerce: (value: string): Includes =>
      throwIfError(parseSerialIncludes(value)),
  },
} as const;

export const orderByOption = {
  orderBy: {
    alias: "o",
    describe: "sort order (e.g. !priority,createdAt)",
    type: "string",
    coerce: parseSerialOrderBy,
  },
} as const;

// --- Transaction metadata options ---

const txTagEnv = process.env.BINDER_TX_TAG;
const txMessageEnv = process.env.BINDER_TX_MESSAGE;
const txSourceEnv = process.env.BINDER_TX_SOURCE;

export const txMetadataOptions = {
  "tx-tag": {
    describe:
      "tag to attach to the transaction (repeatable or comma-separated)",
    type: "string",
    array: true,
    default: txTagEnv ? parseCommaSeparatedList(txTagEnv) : undefined,
  },
  "tx-message": {
    describe: "message to attach to the transaction",
    type: "string",
    default: txMessageEnv,
  },
  "tx-source": {
    describe: "source record reference (uid or key) for provenance",
    type: "string",
    default: txSourceEnv,
  },
} as const;

export type TxMetadata = {
  tags?: string[];
  message?: string;
  source?: string;
  channel?: string;
};

export type TxMetadataArgs = { txMeta: TxMetadata };

/**
 * Adds --tx-tag/--tx-message/--tx-source options and a middleware that
 * normalizes them into `args.txMeta` with `channel: "cli"` baked in.
 */
export const withTxMetadata = <T>(yargs: Argv<T>): Argv<T & TxMetadataArgs> =>
  yargs.options(txMetadataOptions).middleware((argv) => {
    const raw = argv as {
      txTag?: string | string[];
      txMessage?: string;
      txSource?: string;
      txMeta?: TxMetadata;
    };
    const tags = raw.txTag ? parseCommaSeparatedList(raw.txTag) : undefined;
    raw.txMeta = {
      ...(tags && tags.length > 0 && { tags }),
      ...(raw.txMessage && { message: raw.txMessage }),
      ...(raw.txSource && { source: raw.txSource }),
      channel: "cli",
    };
  }) as unknown as Argv<T & TxMetadataArgs>;

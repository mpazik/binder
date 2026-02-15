import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { fail, isErr, ok, type ResultAsync } from "@binder/utils";
import {
  typeSystemType,
  type EntityKey,
  type TransactionInput,
} from "@binder/db";
import { isBundled } from "../build-time.ts";
import { parseTransactionInputContent } from "../utils/parse.ts";
import type { FileSystem } from "./filesystem.ts";

export type BlueprintInfo = {
  name: string;
  path: string;
  description: string;
  types: EntityKey[];
};

const getBlueprintsDir = (): string => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  return isBundled()
    ? join(__dirname, "blueprints")
    : join(__dirname, "../../data/blueprints");
};

const capitalize = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1);

const extractTypesFromTransactions = (
  transactions: TransactionInput[],
): EntityKey[] => {
  const types: EntityKey[] = [];

  for (const tx of transactions) {
    for (const config of tx.configs ?? []) {
      if (config.type === typeSystemType && "key" in config) {
        types.push(config.key as EntityKey);
      }
    }
  }

  return types;
};

const generateDescription = (types: EntityKey[]): string => {
  if (types.length === 0) return "No types defined";
  return `Provides: ${types.join(", ")}`;
};

export const listBlueprints = async (
  fs: FileSystem,
): ResultAsync<BlueprintInfo[]> => {
  const blueprintsDir = getBlueprintsDir();

  const existsResult = await fs.exists(blueprintsDir);
  if (!existsResult) return ok([]);

  const filesResult = await fs.readdir(blueprintsDir);
  if (isErr(filesResult)) return filesResult;

  const blueprints: BlueprintInfo[] = [];

  for (const entry of filesResult.data) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;

    const name = capitalize(entry.name.replace(".yaml", ""));
    const path = join(blueprintsDir, entry.name);

    const transactionsResult = await loadBlueprint(fs, path, "system");
    if (isErr(transactionsResult)) continue;

    const types = extractTypesFromTransactions(transactionsResult.data);
    const description = generateDescription(types);

    blueprints.push({ name, path, description, types });
  }

  return ok(blueprints);
};

export const loadBlueprint = async (
  fs: FileSystem,
  blueprintPath: string,
  defaultAuthor: string,
): ResultAsync<TransactionInput[]> => {
  const contentResult = await fs.readFile(blueprintPath);
  if (isErr(contentResult))
    return fail("blueprint-read-error", "Failed to read blueprint file", {
      path: blueprintPath,
      error: contentResult.error,
    });

  const parseResult = parseTransactionInputContent(
    contentResult.data,
    "yaml",
    defaultAuthor,
  );
  if (isErr(parseResult))
    return fail("blueprint-validation-error", parseResult.error.message, {
      path: blueprintPath,
      ...parseResult.error.data,
    });

  return ok(parseResult.data);
};

import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Argv } from "yargs";
import { isCancel, select } from "@clack/prompts";
import {
  assertDefined,
  fail,
  isErr,
  isOk,
  ok,
  okVoid,
  tryCatch,
} from "@binder/utils";
import { init as repoInit } from "@binder/repo/local";
import {
  bootstrapMinimal,
  type CommandHandlerMinimal,
  type CommandHandlerWithDb,
  runtimeWithDb,
} from "../runtime.ts";
import { cliMigrationRunner, cliSchema } from "../db";
import { BINDER_DIR } from "../config.ts";
import {
  type BlueprintInfo,
  listBlueprints,
  loadBlueprint,
} from "../lib/blueprint.ts";
import { createUi, textInfo } from "../cli/ui.ts";
import { types } from "../cli/types.ts";

const ui = createUi();

const GITIGNORE_CONTENT = `*
!data/
data/*
!data/transactions.jsonl
!config.yaml
`;

const getAuthorNameFromGit = (): string | undefined => {
  const result = tryCatch(() =>
    execSync("git config user.name", { encoding: "utf-8" }).trim(),
  );
  if (isOk(result) && result.data) return result.data;
};

const NONE_BLUEPRINT: BlueprintInfo = {
  name: "None",
  path: "",
  description: "Start with empty schema",
  types: [],
};

const findBlueprint = (
  blueprintArg: string,
  blueprints: BlueprintInfo[],
): BlueprintInfo | undefined =>
  blueprints.find((bp) => bp.name.toLowerCase() === blueprintArg.toLowerCase());

const DEFAULT_BLUEPRINT_NAME = "Default";

// Order: Default first (bare-bones starting point), others alphabetical, None last.
const orderBlueprints = (available: BlueprintInfo[]): BlueprintInfo[] => {
  const defaultBp = available.find((bp) => bp.name === DEFAULT_BLUEPRINT_NAME);
  const rest = available
    .filter((bp) => bp.name !== DEFAULT_BLUEPRINT_NAME)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...(defaultBp ? [defaultBp] : []), ...rest, NONE_BLUEPRINT];
};

const initSetupHandler: CommandHandlerMinimal<{
  docsPath?: string;
  author?: string;
  blueprint?: string;
  quiet?: boolean;
}> = async ({ fs, args }) => {
  const currentDir = process.cwd();
  const binderDirPath = join(currentDir, BINDER_DIR);

  const blueprintsResult = await listBlueprints(fs);
  const availableBlueprints = isOk(blueprintsResult)
    ? blueprintsResult.data
    : [];
  const allBlueprints = orderBlueprints(availableBlueprints);

  if (args.blueprint && !findBlueprint(args.blueprint, allBlueprints)) {
    const available = allBlueprints.map((bp) => bp.name.toLowerCase());
    return fail(
      "invalid-blueprint",
      `Unknown blueprint: ${args.blueprint}. Available: ${available.join(", ")}`,
    );
  }

  const gitAuthor = !args.author ? getAuthorNameFromGit() : undefined;
  const author =
    args.author ??
    (args.quiet
      ? gitAuthor
      : (
          await ui.input(
            `Author name ${gitAuthor ? `(default: ${gitAuthor}): ` : ""}`,
          )
        ).trim() || gitAuthor);

  const initialConfig: Record<string, unknown> = {};
  if (author) initialConfig.author = author;
  if (args.docsPath) initialConfig.docsPath = args.docsPath;

  // Core workspace setup: creates .binder/data/, writes config.yaml, and
  // opens+migrates the DB with CLI's merged migrations. We close immediately;
  // runtimeWithDb reopens for blueprint application below.
  const initResult = await repoInit(currentDir, {
    binderDir: BINDER_DIR,
    initialConfig,
    dbSchema: cliSchema,
    migrate: { run: cliMigrationRunner },
  });
  if (isErr(initResult)) return initResult;
  initResult.data.close();

  // CLI-specific: .gitignore
  const gitignorePath = join(binderDirPath, ".gitignore");
  const writeGitignoreResult = await fs.writeFile(
    gitignorePath,
    GITIGNORE_CONTENT,
  );
  if (isErr(writeGitignoreResult)) return writeGitignoreResult;

  let selectedBlueprint: BlueprintInfo;
  if (args.blueprint) {
    const found = findBlueprint(args.blueprint, allBlueprints);
    assertDefined(found, "blueprint (validated above)");
    selectedBlueprint = found;
  } else if (args.quiet) {
    selectedBlueprint = NONE_BLUEPRINT;
  } else {
    const options = allBlueprints.map((bp) => ({
      value: bp,
      label: `${bp.name} - ${bp.description}`,
    }));

    const selection = await select({
      message: "Select a blueprint:",
      options,
    });

    if (isCancel(selection))
      return fail("cancelled", "Initialization cancelled");

    selectedBlueprint = selection as BlueprintInfo;
  }

  await runtimeWithDb<InitSchemaArgs>(initSchemaHandler)({
    blueprint: selectedBlueprint,
  });
  return ok({
    telemetry: { blueprint: selectedBlueprint.name.toLowerCase() },
  });
};

type InitSchemaArgs = {
  blueprint: BlueprintInfo;
};

const initSchemaHandler: CommandHandlerWithDb<InitSchemaArgs> = async ({
  kg,
  ui,
  config,
  fs,
  args,
}) => {
  if (args.blueprint.path) {
    const blueprintResult = await loadBlueprint(
      fs,
      args.blueprint.path,
      config.author,
    );
    if (isErr(blueprintResult)) return blueprintResult;

    for (const tx of blueprintResult.data) {
      const txResult = await kg.update(tx);
      if (isErr(txResult)) return txResult;
    }
  }

  if (config.paths.docs !== config.paths.root) {
    const mkdirResult = await fs.mkdir(config.paths.docs, { recursive: true });
    if (isErr(mkdirResult)) return mkdirResult;
  }

  ui.block(() => {
    ui.success("Binder workspace initialized successfully");
    if (args.blueprint.path) {
      ui.info(`Applied blueprint: ${args.blueprint.name}`);
    }
  });

  ui.println(
    "Install agent skills: " + textInfo("npx skills add mpazik/binder"),
  );

  return okVoid;
};

export const InitCommand = types({
  command: "init",
  describe: "initialize a new binder workspace",
  builder: (yargs: Argv) => {
    return yargs
      .option("author", {
        describe: "author name for commits",
        type: "string",
        alias: "a",
      })
      .option("docs-path", {
        describe: "path to documents directory (default: current directory)",
        type: "string",
        alias: "d",
      })
      .option("blueprint", {
        describe: "blueprint to apply (e.g., personal, project, or none)",
        type: "string",
        alias: "b",
      });
  },
  handler: bootstrapMinimal(initSetupHandler),
});

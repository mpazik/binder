import { join } from "path";
import type { Argv } from "yargs";
import * as YAML from "yaml";
import { $ } from "bun";
import { isCancel, select } from "@clack/prompts";
import {
  fail,
  isErr,
  isOk,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import {
  bootstrapMinimal,
  type CommandHandlerMinimal,
  type CommandHandlerWithDb,
  runtimeWithDb,
} from "../runtime.ts";
import {
  BINDER_DIR,
  CONFIG_FILE,
  DEFAULT_DOCS_PATH,
  findBinderRoot,
} from "../config.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import {
  type BlueprintInfo,
  listBlueprints,
  loadBlueprint,
} from "../lib/blueprint.ts";
import { createUi } from "../cli/ui.ts";

const ui = createUi();
import { types } from "../cli/types.ts";

const GITIGNORE_CONTENT = `*
!transactions.jsonl
!config.yaml
`;

const getAuthorNameFromGit = async (): Promise<string | undefined> => {
  const gitResult = await tryCatch(async () => {
    const result = await $`git config user.name`.text();
    return result.trim();
  });

  if (isOk(gitResult)) return gitResult.data ?? undefined;
};

const isDirectoryEmpty = async (
  fs: FileSystem,
  path: string,
): ResultAsync<boolean> => {
  const exists = await fs.exists(path);
  if (!exists) return ok(true);
  const filesResult = await fs.readdir(path);
  if (isErr(filesResult)) return filesResult;
  return ok(filesResult.data.length === 0);
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

const initSetupHandler: CommandHandlerMinimal<{
  docsPath?: string;
  author?: string;
  blueprint?: string;
}> = async ({ fs, args }) => {
  const currentDir = process.cwd();
  const binderDirPath = join(currentDir, BINDER_DIR);

  const existingRootResult = await findBinderRoot(fs, currentDir);
  if (isErr(existingRootResult)) return existingRootResult;

  if (existingRootResult.data !== null) {
    const message =
      existingRootResult.data === currentDir
        ? "Binder workspace already initialized in current directory"
        : `Cannot initialize nested workspace. Existing workspace at: ${existingRootResult.data}`;
    return fail("workspace-exists", message);
  }

  const blueprintsResult = await listBlueprints(fs);
  const availableBlueprints = isOk(blueprintsResult)
    ? blueprintsResult.data
    : [];
  const allBlueprints = [NONE_BLUEPRINT, ...availableBlueprints];

  if (args.blueprint && !findBlueprint(args.blueprint, allBlueprints)) {
    const available = allBlueprints.map((bp) => bp.name.toLowerCase());
    return fail(
      "invalid-blueprint",
      `Unknown blueprint: ${args.blueprint}. Available: ${available.join(", ")}`,
    );
  }

  let author = args.author;
  if (!author) {
    const gitAuthor = await getAuthorNameFromGit();
    const input = await ui.input(
      `Author name ${gitAuthor ? `(default: ${gitAuthor}): ` : ""}`,
    );
    author = input.trim() || gitAuthor;
  }

  let docsPath = args.docsPath;
  if (!docsPath) {
    while (true) {
      const input = await ui.input(
        `Documents directory (default: ${DEFAULT_DOCS_PATH}): `,
      );
      docsPath = input.trim() || DEFAULT_DOCS_PATH;

      const fullPath = join(currentDir, docsPath);
      const isEmptyResult = await isDirectoryEmpty(fs, fullPath);
      if (isErr(isEmptyResult)) return isEmptyResult;
      if (isOk(isEmptyResult) && isEmptyResult.data) break;

      ui.error(
        `Directory '${docsPath}' is not empty. Please choose an empty directory or a new directory.`,
      );
    }
  } else {
    const fullPath = join(currentDir, docsPath);
    const isEmptyResult = await isDirectoryEmpty(fs, fullPath);
    if (isErr(isEmptyResult)) return isEmptyResult;
    if (isOk(isEmptyResult) && !isEmptyResult.data) {
      return fail(
        "directory-not-empty",
        `Directory '${docsPath}' is not empty`,
      );
    }
  }

  const config = { author, docsPath };

  const mkdirResult = await fs.mkdir(binderDirPath, { recursive: true });
  if (isErr(mkdirResult)) return mkdirResult;

  const configPath = join(binderDirPath, CONFIG_FILE);
  const configYaml = YAML.stringify(config, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
  });

  const writeConfigResult = await fs.writeFile(configPath, configYaml);
  if (isErr(writeConfigResult)) return writeConfigResult;

  const gitignorePath = join(binderDirPath, ".gitignore");
  const writeGitignoreResult = await fs.writeFile(
    gitignorePath,
    GITIGNORE_CONTENT,
  );
  if (isErr(writeGitignoreResult)) return writeGitignoreResult;

  let selectedBlueprint: BlueprintInfo;
  if (args.blueprint) {
    selectedBlueprint =
      findBlueprint(args.blueprint, allBlueprints) ?? NONE_BLUEPRINT;
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

  return ok(
    await runtimeWithDb<InitSchemaArgs>(initSchemaHandler)({
      blueprint: selectedBlueprint,
    }),
  );
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

  return ok(undefined);
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
        describe: "path to documents directory",
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

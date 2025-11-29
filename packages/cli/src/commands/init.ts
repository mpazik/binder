import { join } from "path";
import type { Argv } from "yargs";
import * as YAML from "yaml";
import { $ } from "bun";
import { isErr, isOk, ok, type ResultAsync, tryCatch } from "@binder/utils";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { documentSchemaTransactionInput } from "../document/document-schema.ts";
import {
  BINDER_DIR,
  CONFIG_FILE,
  DEFAULT_DOCS_PATH,
  findBinderRoot,
} from "../config.ts";
import * as ui from "../ui.ts";
import { createRealFileSystem, type FileSystem } from "../lib/filesystem.ts";
import { types } from "./types.ts";

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

const initSetupHandler = async (args: {
  docsPath?: string;
  author?: string;
}): Promise<void> => {
  const currentDir = process.cwd();
  const fs = createRealFileSystem();

  const existingRootResult = await findBinderRoot(fs, currentDir);
  if (isErr(existingRootResult)) {
    ui.error(
      `Failed to check for existing workspace: ${existingRootResult.error.message}`,
    );
    process.exit(1);
  }

  if (existingRootResult.data !== null) {
    if (existingRootResult.data === currentDir) {
      ui.error("Binder workspace already initialized in current directory");
      process.exit(1);
    }
    ui.error(
      `Cannot initialize a nested binder workspace. Existing workspace found at: ${existingRootResult.data}`,
    );
    process.exit(1);
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
      if (isErr(isEmptyResult)) {
        ui.error(
          `Failed to read directory status: ${isEmptyResult.error.message}`,
        );
      }
      if (isEmptyResult) break;

      ui.error(
        `Directory '${docsPath}' is not empty. Please choose an empty directory or a new directory.`,
      );
    }
  } else {
    const fullPath = join(currentDir, docsPath);
    if (!isDirectoryEmpty(fs, fullPath)) {
      ui.error(
        `Directory '${docsPath}' is not empty. Please choose an empty directory or a new directory.`,
      );
      process.exit(1);
    }
  }

  const config = {
    author,
    docsPath,
  };

  const binderDirPath = join(currentDir, BINDER_DIR);
  const mkdirResult = await fs.mkdir(binderDirPath, { recursive: true });
  if (isErr(mkdirResult)) {
    ui.error(
      `Failed to create .binder directory: ${mkdirResult.error.message}`,
    );
    process.exit(1);
  }

  const configPath = join(binderDirPath, CONFIG_FILE);
  const configYaml = YAML.stringify(config, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
  });

  const writeConfigResult = await fs.writeFile(configPath, configYaml);

  if (isErr(writeConfigResult)) {
    ui.error(`Failed to write config file: ${writeConfigResult.error.message}`);
    process.exit(1);
  }

  const gitignorePath = join(binderDirPath, ".gitignore");
  const writeGitignoreResult = await fs.writeFile(
    gitignorePath,
    GITIGNORE_CONTENT,
  );

  if (isErr(writeGitignoreResult)) {
    ui.error(
      `Failed to write .gitignore: ${writeGitignoreResult.error.message}`,
    );
    process.exit(1);
  }

  if (docsPath !== ".") {
    const docsDirPath = join(currentDir, docsPath);
    if (!(await fs.exists(docsDirPath))) {
      const mkdirDocsResult = await fs.mkdir(docsDirPath, { recursive: true });

      if (isErr(mkdirDocsResult)) {
        ui.error(
          `Failed to create docs directory: ${mkdirDocsResult.error.message}`,
        );
        process.exit(1);
      }
    }
  }

  await runtimeWithDb(initSchemaHandler)({});
};

const initSchemaHandler: CommandHandlerWithDb = async ({
  kg,
  ui,
  config,
  fs,
}) => {
  const schemaResult = await kg.update(documentSchemaTransactionInput);
  if (isErr(schemaResult)) return schemaResult;

  if (config.paths.docs !== config.paths.root) {
    const mkdirResult = await fs.mkdir(config.paths.docs, { recursive: true });
    if (isErr(mkdirResult)) {
      ui.error(`Failed to create docs directory: ${mkdirResult.error.message}`);
      return mkdirResult;
    }
  }

  ui.block(() => {
    ui.success("Binder workspace initialized successfully");
  });

  process.exit(0);
  return ok(undefined);
};

const InitCommand = types({
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
      });
  },
  handler: initSetupHandler,
});

export default InitCommand;

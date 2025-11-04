import { join } from "path";
import type { Argv } from "yargs";
import * as YAML from "yaml";
import { $ } from "bun";
import { errorToObject, isErr, isOk, ok, tryCatch } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
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

const GITIGNORE_CONTENT = `# Ignore everything in .binder except logs and config
*
!log.jsonl
!config.yaml
`;

const getAuthorNameFromGit = async (): Promise<string | undefined> => {
  const gitResult = await tryCatch(async () => {
    const result = await $`git config user.name`.text();
    return result.trim();
  }, errorToObject);

  if (isOk(gitResult)) return gitResult.data ?? undefined;
};

const isDirectoryEmpty = (fs: FileSystem, path: string): boolean => {
  if (!fs.exists(path)) return true;
  const filesResult = fs.readdir(path);
  if (isErr(filesResult)) return false;
  return filesResult.data.length === 0;
};

const initSetupHandler = async (args: {
  docsPath?: string;
  author?: string;
}): Promise<void> => {
  const currentDir = process.cwd();
  const fs = createRealFileSystem();

  const existingRootResult = findBinderRoot(fs, currentDir);
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
      if (isDirectoryEmpty(fs, fullPath)) break;

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
  const mkdirResult = fs.mkdir(binderDirPath, { recursive: true });
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

  const writeConfigResult = fs.writeFile(configPath, configYaml);

  if (isErr(writeConfigResult)) {
    ui.error(`Failed to write config file: ${writeConfigResult.error.message}`);
    process.exit(1);
  }

  const gitignorePath = join(binderDirPath, ".gitignore");
  const writeGitignoreResult = fs.writeFile(gitignorePath, GITIGNORE_CONTENT);

  if (isErr(writeGitignoreResult)) {
    ui.error(
      `Failed to write .gitignore: ${writeGitignoreResult.error.message}`,
    );
    process.exit(1);
  }

  if (docsPath !== ".") {
    const docsDirPath = join(currentDir, docsPath);
    if (!fs.exists(docsDirPath)) {
      const mkdirDocsResult = fs.mkdir(docsDirPath, { recursive: true });

      if (isErr(mkdirDocsResult)) {
        ui.error(
          `Failed to create docs directory: ${mkdirDocsResult.error.message}`,
        );
        process.exit(1);
      }
    }
  }

  await bootstrapWithDbWrite(initSchemaHandler)({});
};

const initSchemaHandler: CommandHandlerWithDbWrite = async ({
  kg,
  ui,
  config,
  fs,
}) => {
  const schemaResult = await kg.update(documentSchemaTransactionInput);
  if (isErr(schemaResult)) return schemaResult;

  if (config.paths.docs !== config.paths.root) {
    const mkdirResult = fs.mkdir(config.paths.docs, { recursive: true });
    if (isErr(mkdirResult)) {
      ui.error(`Failed to create docs directory: ${mkdirResult.error.message}`);
      return mkdirResult;
    }
  }

  ui.println(
    ui.Style.TEXT_SUCCESS +
      "✓ Binder workspace initialized successfully" +
      ui.Style.TEXT_NORMAL,
  );

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

import type { Argv } from "yargs";
import type { NamespaceEditable } from "@binder/db";
import { fail, isErr, ok, type ResultAsync } from "@binder/utils";
import {
  type CommandHandlerWithDb,
  type RuntimeContextWithDb,
  runtimeWithDb,
} from "../runtime.ts";
import { renderDocs } from "../document/repository.ts";
import { synchronizeModifiedFiles } from "../document/synchronizer.ts";
import {
  findNavigationItemByPath,
  loadNavigation,
} from "../document/navigation.ts";
import {
  getRelativeSnapshotPath,
  namespaceFromSnapshotPath,
  resolveSnapshotPath,
  snapshotRootForNamespace,
} from "../lib/snapshot.ts";
import type { ValidationError } from "../validation";
import { validateDocument } from "../validation";
import { getDocumentFileType, parseDocument } from "../document/document.ts";
import { createPathMatcher } from "../utils/file.ts";
import { types } from "./types.ts";

export const docsRenderHandler: CommandHandlerWithDb = async (context) => {
  const { ui } = context;
  const result = await renderDocs(context);
  if (isErr(result)) return result;

  ui.println("Documentation and configuration files rendered successfully");
  return ok(undefined);
};

export const docsSyncHandler: CommandHandlerWithDb<{
  path?: string;
}> = async (ctx) => {
  const { kg, ui, args, log } = ctx;
  const syncResult = await synchronizeModifiedFiles(ctx, args.path, log);
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data === null) {
    ui.println("No changes detected");
    return ok(undefined);
  }

  const updateResult = await kg.update(syncResult.data);
  if (isErr(updateResult)) return updateResult;

  const changeCount =
    (syncResult.data.nodes?.length ?? 0) +
    (syncResult.data.configurations?.length ?? 0);

  ui.block(() => {
    ui.printTransaction(updateResult.data);
  });
  ui.success(
    `Synchronized ${changeCount} change${changeCount === 1 ? "" : "s"}`,
  );
  return ok(undefined);
};

const lintNamespace = async <N extends NamespaceEditable>(
  { fs, ui, config, kg }: RuntimeContextWithDb,
  namespace: N,
  scanPath: string,
): ResultAsync<{ errors: number; warnings: number }> => {
  const ruleConfig = config.validation?.rules ?? {};
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;

  let currentFile = "";
  const printError = (relativePath: string, error: ValidationError) => {
    if (currentFile !== relativePath) {
      ui.println(`\n${relativePath}:`);
      currentFile = relativePath;
    }
    const location = `${error.range.start.line + 1}:${error.range.start.character + 1}`;
    const severity = error.severity === "error" ? "error" : error.severity;
    ui.println(`  ${location} ${severity} ${error.message} (${error.code})`);
  };

  const navigationResult = await loadNavigation(kg, namespace);
  if (isErr(navigationResult)) return navigationResult;

  const shouldInclude =
    namespace === "node"
      ? createPathMatcher({ include: config.include, exclude: config.exclude })
      : () => true;

  let errors = 0;
  let warnings = 0;

  for await (const filePath of fs.scan(scanPath)) {
    const fileType = getDocumentFileType(filePath);
    if (fileType === undefined) continue;

    const relativePath = getRelativeSnapshotPath(filePath, config.paths);

    if (!shouldInclude(relativePath)) continue;
    const navigationItem = findNavigationItemByPath(
      navigationResult.data,
      relativePath,
    );

    if (!navigationItem) continue;

    const contentResult = await fs.readFile(filePath);
    if (isErr(contentResult)) {
      ui.println(`  error ${contentResult.error.message ?? "Unknown error"}`);
      errors += 1;
      continue;
    }

    const content = parseDocument(contentResult.data, fileType);
    const result = await validateDocument(content, {
      filePath,
      navigationItem,
      namespace,
      schema: schemaResult.data,
      ruleConfig,
      kg,
    });

    for (const error of result.errors) {
      printError(relativePath, error);
    }
    for (const warning of result.warnings) {
      printError(relativePath, warning);
    }

    errors += result.errors.length;
    warnings += result.warnings.length;
  }

  return ok({ errors, warnings });
};

export const docsLintHandler: CommandHandlerWithDb<{
  path?: string;
  all?: boolean;
  config?: boolean;
}> = async (context) => {
  const { ui, config, args } = context;

  if (args.all && args.config) {
    return fail("invalid-args", "Cannot use --all and --config flags together");
  }

  if (args.path && (args.all || args.config)) {
    return fail(
      "invalid-args",
      "Cannot specify path with --all or --config flags",
    );
  }
  let toLint: [NamespaceEditable, string][] = [];

  if (args.path) {
    const absolutePath = resolveSnapshotPath(args.path, config.paths);
    const namespace = namespaceFromSnapshotPath(absolutePath, config.paths);
    if (!namespace) {
      return fail(
        "invalid-path",
        `Path is outside known directories: ${args.path}`,
      );
    }
    toLint = [[namespace, absolutePath]];
  } else {
    const namespacesToLint: NamespaceEditable[] = args.all
      ? ["node", "config"]
      : args.config
        ? ["config"]
        : ["node"];
    toLint = namespacesToLint.map((ns) => [
      ns,
      snapshotRootForNamespace(ns, config.paths),
    ]);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [namespace, scanPath] of toLint) {
    const result = await lintNamespace(context, namespace, scanPath);
    if (isErr(result)) return result;

    totalErrors += result.data.errors;
    totalWarnings += result.data.warnings;
  }

  ui.println("");
  if (totalErrors > 0 || totalWarnings > 0) {
    ui.println(
      `Found ${totalErrors} error${totalErrors === 1 ? "" : "s"} and ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`,
    );
    if (totalErrors > 0) {
      return fail("validation-failed", "Validation failed with errors");
    }
    return ok(undefined);
  }

  return ok("No validation issues found");
};

const DocsCommand = types({
  command: "docs <command>",
  describe: "manage documentation",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "render",
          describe: "render documents to markdown files",
          handler: runtimeWithDb(docsRenderHandler),
        }),
      )
      .command(
        types({
          command: "sync [path]",
          describe:
            "synchronize files with the knowledge graph (file, directory, or all modified files)",
          builder: (yargs: Argv) => {
            return yargs.positional("path", {
              describe:
                "path to file or directory (omit to sync all modified files)",
              type: "string",
              demandOption: false,
            });
          },
          handler: runtimeWithDb(docsSyncHandler),
        }),
      )
      .command(
        types({
          command: "lint [path]",
          describe: "validate YAML and Markdown files",
          builder: (yargs: Argv) => {
            return yargs
              .positional("path", {
                describe:
                  "path to file or directory to validate (defaults to docs directory)",
                type: "string",
              })
              .option("all", {
                describe: "validate both docs and config files",
                type: "boolean",
                default: false,
              })
              .option("config", {
                describe: "validate config files (.binder directory)",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(docsLintHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: render, sync, lint");
  },
  handler: async () => {},
});
export default DocsCommand;

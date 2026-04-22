import type { Argv } from "yargs";
import type { NamespaceEditable } from "@binder/repo";
import { fail, isErr, ok, okVoid, type ResultAsync } from "@binder/utils";
import {
  type CommandHandlerWithDb,
  type RuntimeContextWithDb,
  runtimeWithDb,
} from "../runtime.ts";
import { renderDocs } from "../document/repository.ts";
import { extractModifiedFileChanges } from "../document/change-extractor.ts";
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
import { types } from "../cli/types.ts";
import { resolveTransactionDisplayKey } from "../cli/ui.ts";

export const docsRenderHandler: CommandHandlerWithDb<{
  force?: boolean;
}> = async (context) => {
  const { ui, args } = context;
  const result = await renderDocs({ ...context, force: args.force ?? false });
  if (isErr(result)) return result;

  if (result.data.divergedPaths.length > 0) {
    ui.println(
      `Warning: ${result.data.divergedPaths.length} file(s) have local changes that differ from the database:`,
    );
    for (const path of result.data.divergedPaths) {
      ui.println(`  ${path}`);
    }
    ui.println(
      "These files were not overwritten. Run 'docs render --force' to restore them from the database.",
    );
  } else {
    ui.println("Documentation and configuration files rendered successfully");
  }

  return okVoid;
};

export const docsSyncHandler: CommandHandlerWithDb<{
  path?: string;
}> = async (ctx) => {
  const { kg, ui, args, log, config } = ctx;
  const resolvedPath = args.path
    ? resolveSnapshotPath(args.path, config.paths)
    : undefined;
  const syncResult = await extractModifiedFileChanges(ctx, resolvedPath, log);
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data === null) {
    ui.println("No changes detected");
    return ok({ telemetry: { record_count: 0, config_count: 0 } });
  }

  const updateResult = await kg.update(syncResult.data);
  if (isErr(updateResult)) return updateResult;

  const resolved = await resolveTransactionDisplayKey(kg, updateResult.data);
  ui.block(() => {
    ui.printRawTransaction(resolved);
  });
  ui.success("Synchronized successfully");
  return ok({
    telemetry: {
      record_count: syncResult.data.records?.length ?? 0,
      config_count: syncResult.data.configs?.length ?? 0,
    },
  });
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
  const printDiagnostic = (
    relativePath: string,
    diagnostic: ValidationError,
  ) => {
    if (currentFile !== relativePath) {
      ui.println(`\n${relativePath}:`);
      currentFile = relativePath;
    }
    const location = `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
    ui.println(
      `  ${location} ${diagnostic.severity} ${diagnostic.message} (${diagnostic.code})`,
    );
  };

  const navigationResult = await loadNavigation(kg, namespace);
  if (isErr(navigationResult)) return navigationResult;

  const shouldInclude =
    namespace === "record"
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

    for (const diagnostic of result.errors) {
      printDiagnostic(relativePath, diagnostic);
    }
    for (const diagnostic of result.warnings) {
      printDiagnostic(relativePath, diagnostic);
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

  let toLint: [NamespaceEditable, string][];

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
    const namespaces: NamespaceEditable[] = args.all
      ? ["record", "config"]
      : args.config
        ? ["config"]
        : ["record"];
    toLint = namespaces.map((ns) => [
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

  if (totalErrors > 0 || totalWarnings > 0) {
    ui.warning(
      `Found ${totalErrors} error${totalErrors === 1 ? "" : "s"} and ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`,
    );
    if (totalErrors > 0) {
      return fail("validation-failed", "Validation failed with errors");
    }
    return ok(undefined);
  }

  return ok("No validation issues found");
};

export const DocsCommand = types({
  command: "docs <command>",
  describe: "manage documentation",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "render",
          describe: "render documents to markdown files",
          builder: (yargs: Argv) => {
            return yargs.option("force", {
              describe:
                "overwrite files that have diverged from the database state",
              type: "boolean",
              default: false,
            });
          },
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

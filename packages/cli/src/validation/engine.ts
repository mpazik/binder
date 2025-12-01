import { relative } from "path";
import {
  assertDefinedPass,
  fail,
  isErr,
  ok,
  type ResultAsync,
} from "@binder/utils";
import type {
  EntitySchema,
  KnowledgeGraph,
  Namespace,
  NamespaceEditable,
  NamespaceSchema,
} from "@binder/db";
import {
  findNavigationItemByPath,
  type NavigationItem,
} from "../document/navigation.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { ConfigPaths } from "../config.ts";
import type { ParsedYaml } from "../document/yaml-cst.ts";
import type { ParsedMarkdown } from "../document/markdown.ts";
import {
  getDocumentFileType,
  type ParsedDocument,
  parseDocument,
} from "../document/document.ts";
import type {
  ValidationContext,
  ValidationError,
  ValidationResult,
  ValidationRuleConfig,
  ValidationSeverity,
} from "./types.ts";
import { createValidationResult } from "./types.ts";
import { createYamlValidator } from "./validators/yaml.ts";
import { createMarkdownValidator } from "./validators/markdown.ts";

export const applyRuleConfig = (
  errors: ValidationError[],
  config: ValidationRuleConfig,
): ValidationError[] => {
  return errors
    .map((error) => {
      const ruleLevel = config[error.code];
      if (ruleLevel === "off") return null;

      if (ruleLevel && ruleLevel !== error.severity) {
        return { ...error, severity: ruleLevel as ValidationSeverity };
      }
      return error;
    })
    .filter((e): e is ValidationError => e !== null);
};

export const validateDocument = async <N extends Namespace>(
  content: ParsedDocument,
  context: ValidationContext<N>,
): Promise<ValidationResult> => {
  const fileType = getDocumentFileType(context.filePath);

  let errors: ValidationError[] = [];

  if (fileType === "yaml") {
    errors = await createYamlValidator().validate(
      content as ParsedYaml,
      context,
    );
  } else if (fileType === "markdown") {
    errors = await createMarkdownValidator().validate(
      content as ParsedMarkdown,
      context,
    );
  }

  const filteredErrors = applyRuleConfig(errors, context.ruleConfig);
  return createValidationResult(filteredErrors);
};

export const validateFile = async <N extends NamespaceEditable>(
  fs: FileSystem,
  kg: KnowledgeGraph,
  filePath: string,
  navigationItems: NavigationItem[],
  namespace: N,
  schema: NamespaceSchema<N>,
  paths: ConfigPaths,
  ruleConfig: ValidationRuleConfig,
): ResultAsync<ValidationResult> => {
  const contentResult = await fs.readFile(filePath);
  if (isErr(contentResult)) return contentResult;

  const relativePath = relative(paths.docs, filePath);
  const navigationItem = findNavigationItemByPath(
    navigationItems,
    relativePath,
  );

  if (!navigationItem)
    return fail(
      "navigation-item-not-found",
      `No navigation item found for: ${relativePath}`,
    );

  const content = parseDocument(
    contentResult.data,
    assertDefinedPass(getDocumentFileType(filePath)),
  );
  return ok(
    await validateDocument(content, {
      filePath,
      namespace,
      navigationItem,
      schema,
      ruleConfig,
      kg,
    }),
  );
};

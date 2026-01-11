import { fileURLToPath } from "node:url";
import type {
  Diagnostic,
  DocumentDiagnosticParams,
  DocumentDiagnosticReport,
} from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { NamespaceSchema } from "@binder/db";
import {
  validateDocument,
  type ValidationError,
  type ValidationSeverity,
} from "../../validation";
import type { LspHandler } from "../document-context.ts";

const severityToDiagnosticSeverity: Record<
  ValidationSeverity,
  DiagnosticSeverity
> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

const validationErrorToDiagnostic = (error: ValidationError): Diagnostic => ({
  range: error.range,
  severity: severityToDiagnosticSeverity[error.severity],
  message: error.message,
  source: "binder",
  code: error.code,
  data: error.data,
});

export const handleDiagnostics: LspHandler<
  DocumentDiagnosticParams,
  DocumentDiagnosticReport
> = async (params, { context, runtime }) => {
  const { kg, log, config } = runtime;
  const filePath = fileURLToPath(params.textDocument.uri);
  const ruleConfig = config.validation?.rules ?? {};

  const validationResult = await validateDocument(context.parsed, {
    kg,
    filePath,
    navigationItem: context.navigationItem,
    namespace: context.namespace,
    schema: context.schema as NamespaceSchema<typeof context.namespace>,
    ruleConfig,
  });

  const diagnostics = [
    ...validationResult.errors,
    ...validationResult.warnings,
  ].map(validationErrorToDiagnostic);

  log.info("Returning diagnostics", {
    filePath,
    errorCount: validationResult.errors.length,
    warningCount: validationResult.warnings.length,
  });

  return {
    kind: "full",
    items: diagnostics,
  };
};

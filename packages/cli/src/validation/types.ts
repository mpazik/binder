import type { KnowledgeGraph, Namespace, NamespaceSchema } from "@binder/db";
import type { NavigationItem } from "../document/navigation.ts";
import type { ParsedDocument } from "../document/document.ts";

export type ValidationSeverity = "error" | "warning" | "info" | "hint";
export type ValidationRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type ValidationError = {
  code: string;
  message: string;
  severity: ValidationSeverity;
  range: ValidationRange;
  data?: unknown;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
};

export type ValidationRuleLevel = ValidationSeverity | "off";
export type ValidationRuleConfig = {
  [ruleCode: string]: ValidationRuleLevel;
};

export type Validator<T extends ParsedDocument> = {
  validate: <N extends Namespace>(
    content: T,
    context: ValidationContext<N>,
  ) => Promise<ValidationError[]> | ValidationError[];
};

export type ValidationContext<N extends Namespace> = {
  filePath: string;
  navigationItem: NavigationItem;
  namespace: N;
  schema: NamespaceSchema<N>;
  ruleConfig: ValidationRuleConfig;
  kg: KnowledgeGraph;
};

export const zeroRange: ValidationRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

export const createValidationError = (
  code: string,
  message: string,
  range: ValidationRange = zeroRange,
  severity: ValidationSeverity = "error",
  data?: unknown,
): ValidationError => ({
  code,
  message,
  severity,
  range,
  data,
});

export const createValidationResult = (
  errors: ValidationError[],
): ValidationResult => {
  const errorList = errors.filter((e) => e.severity === "error");
  const warningList = errors.filter(
    (e) =>
      e.severity === "warning" ||
      e.severity === "info" ||
      e.severity === "hint",
  );

  return {
    valid: errorList.length === 0,
    errors: errorList,
    warnings: warningList,
  };
};

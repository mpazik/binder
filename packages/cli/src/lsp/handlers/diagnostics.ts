import { fileURLToPath } from "node:url";
import type {
  Diagnostic,
  DocumentDiagnosticParams,
  DocumentDiagnosticReport,
} from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { Position as UnistPosition } from "unist";
import {
  type DataTypeNs,
  type EntitySchema,
  type FieldDef,
  type FieldPath,
  type FieldsetNested,
  type FieldValue,
  getFieldDefNested,
  getRelationRef,
  isFieldsetNested,
  type NamespaceEditable,
  type NamespaceSchema,
  validateDataType,
} from "@binder/db";
import { isErr } from "@binder/utils";
import { isMap, isPair, isScalar } from "yaml";
import {
  validateDocument,
  type ValidationError,
  type ValidationRange,
  type ValidationSeverity,
  zeroRange,
} from "../../validation";
import { extract } from "../../document/extraction.ts";
import type { FieldSlotMapping } from "../../document/template.ts";
import type {
  FrontmatterContext,
  LspHandler,
  MarkdownDocumentContext,
} from "../document-context.ts";
import { offsetToPosition } from "../cursor-context.ts";

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

export type FieldValidationError = {
  fieldPath: FieldPath;
  code: "invalid-value";
  message: string;
};

export type FieldValueValidationInput = {
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  value: FieldValue;
  namespace: NamespaceEditable;
};

export const validateFieldValue = (
  input: FieldValueValidationInput,
): FieldValidationError | undefined => {
  const { fieldPath, fieldDef, value, namespace } = input;

  // Null values represent empty/unset fields and are always valid
  if (value === null) return undefined;

  // Normalize single values to arrays for allowMultiple fields
  const normalizedValue =
    fieldDef.allowMultiple && !Array.isArray(value) ? [value] : value;

  const result = validateDataType(
    namespace,
    fieldDef as FieldDef<DataTypeNs[typeof namespace]>,
    normalizedValue,
  );
  if (isErr(result)) {
    return {
      fieldPath,
      code: "invalid-value",
      message: `Invalid value for field '${fieldPath.join(".")}': ${result.error.message}`,
    };
  }
  return undefined;
};

export type RelationRef = {
  fieldPath: FieldPath;
  ref: string;
};

export type ExtractRelationRefsInput = {
  fieldPath: FieldPath;
  fieldDef: FieldDef;
  value: FieldValue;
};

export const extractRelationRefs = (
  input: ExtractRelationRefsInput,
): RelationRef[] => {
  const { fieldPath, fieldDef, value } = input;

  if (fieldDef.dataType !== "relation") return [];
  if (value === null || value === undefined) return [];

  if (fieldDef.allowMultiple && Array.isArray(value)) {
    const refs: RelationRef[] = [];
    for (const item of value) {
      const ref = getRelationRef(item as FieldValue);
      if (ref && !isFieldsetNested(item)) {
        refs.push({ fieldPath, ref });
      }
    }
    return refs;
  }

  if (isFieldsetNested(value)) return [];

  const ref = getRelationRef(value);
  if (!ref) return [];

  return [{ fieldPath, ref }];
};

export const unistPositionToRange = (
  position: UnistPosition,
): ValidationRange => ({
  start: {
    line: position.start.line - 1,
    character: position.start.column - 1,
  },
  end: {
    line: position.end.line - 1,
    character: position.end.column - 1,
  },
});

export const mapFieldPathToRange = (
  fieldPath: FieldPath,
  fieldMappings: FieldSlotMapping[],
): ValidationRange | undefined => {
  const mapping = fieldMappings.find(
    (m) =>
      m.path.length === fieldPath.length &&
      m.path.every((segment, i) => segment === fieldPath[i]),
  );
  if (!mapping?.position) return undefined;
  return unistPositionToRange(mapping.position);
};

export type ValidateMarkdownFieldsInput = {
  fieldset: FieldsetNested;
  schema: EntitySchema;
  namespace: NamespaceEditable;
};

export const validateMarkdownFields = (
  input: ValidateMarkdownFieldsInput,
): FieldValidationError[] => {
  const { fieldset, schema, namespace } = input;
  const errors: FieldValidationError[] = [];

  const validateField = (path: FieldPath, value: FieldValue) => {
    const fieldDef = getFieldDefNested(schema, path);
    if (!fieldDef) return;

    if (fieldDef.dataType === "relation") {
      if (fieldDef.allowMultiple && Array.isArray(value)) {
        for (const item of value) {
          if (isFieldsetNested(item)) {
            validateFieldset(item, path);
          }
        }
      } else if (isFieldsetNested(value)) {
        validateFieldset(value, path);
      }
      return;
    }

    const error = validateFieldValue({
      fieldPath: path,
      fieldDef,
      value,
      namespace,
    });
    if (error) errors.push(error);
  };

  const validateFieldset = (fs: FieldsetNested, parentPath: FieldPath = []) => {
    for (const [key, value] of Object.entries(fs)) {
      const path = [...parentPath, key];
      validateField(path, value as FieldValue);
    }
  };

  validateFieldset(fieldset);
  return errors;
};

export const collectRelationRefs = (
  fieldset: FieldsetNested,
  schema: EntitySchema,
): RelationRef[] => {
  const refs: RelationRef[] = [];

  const collectFromFieldset = (
    fs: FieldsetNested,
    parentPath: FieldPath = [],
  ) => {
    for (const [key, value] of Object.entries(fs)) {
      const path = [...parentPath, key];
      const fieldDef = getFieldDefNested(schema, path);
      if (!fieldDef) continue;

      if (fieldDef.dataType === "relation") {
        const fieldRefs = extractRelationRefs({
          fieldPath: path,
          fieldDef,
          value: value as FieldValue,
        });
        refs.push(...fieldRefs);

        if (fieldDef.allowMultiple && Array.isArray(value)) {
          for (const item of value) {
            if (isFieldsetNested(item)) {
              collectFromFieldset(item, path);
            }
          }
        } else if (isFieldsetNested(value)) {
          collectFromFieldset(value, path);
        }
      }
    }
  };

  collectFromFieldset(fieldset);
  return refs;
};

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

  if (context.documentType === "markdown") {
    const markdownDiagnostics = await getMarkdownDiagnostics(
      context,
      runtime,
      filePath,
    );
    diagnostics.push(...markdownDiagnostics);
  }

  const errorCount = validationResult.errors.length;
  const warningCount = validationResult.warnings.length;
  if (errorCount > 0 || warningCount > 0) {
    log.info("Returning diagnostics", { filePath, errorCount, warningCount });
  } else {
    log.debug("Returning diagnostics", { filePath, errorCount, warningCount });
  }

  return {
    kind: "full",
    items: diagnostics,
  };
};

const mapFrontmatterFieldPathToRange = (
  fieldPath: FieldPath,
  fm: FrontmatterContext,
): ValidationRange | undefined => {
  if (fieldPath.length === 0) return undefined;

  const { parsed, lineOffset } = fm;
  if (!parsed.doc.contents || !isMap(parsed.doc.contents)) return undefined;

  const targetKey = fieldPath[0];
  for (const item of parsed.doc.contents.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    if (String(item.key.value) !== targetKey) continue;

    const valueNode = item.value;
    if (!valueNode || !("range" in valueNode)) continue;

    const range = valueNode.range as [number, number, number];
    const start = offsetToPosition(range[0], parsed.lineCounter);
    const end = offsetToPosition(range[2], parsed.lineCounter);

    return {
      start: { line: start.line + lineOffset, character: start.character },
      end: { line: end.line + lineOffset, character: end.character },
    };
  }

  return undefined;
};

const resolveFieldRange = (
  fieldPath: FieldPath,
  fieldMappings: FieldSlotMapping[],
  frontmatter?: FrontmatterContext,
): ValidationRange => {
  const bodyRange = mapFieldPathToRange(fieldPath, fieldMappings);
  if (bodyRange) return bodyRange;

  if (
    frontmatter &&
    fieldPath.length > 0 &&
    frontmatter.preambleKeys.includes(fieldPath[0]!)
  ) {
    const fmRange = mapFrontmatterFieldPathToRange(fieldPath, frontmatter);
    if (fmRange) return fmRange;
  }

  return zeroRange;
};

const getMarkdownDiagnostics = async (
  context: MarkdownDocumentContext,
  runtime: Parameters<typeof handleDiagnostics>[1]["runtime"],
  filePath: string,
): Promise<Diagnostic[]> => {
  const { kg, log } = runtime;
  const diagnostics: Diagnostic[] = [];

  const templatesResult = await runtime.templates();
  if (isErr(templatesResult)) return diagnostics;

  const content = context.document.getText();
  const relativePath = filePath.replace(runtime.config.paths.docs + "/", "");
  const extractResult = extract(
    context.schema,
    context.navigationItem,
    content,
    relativePath,
    templatesResult.data,
    {},
  );

  if (isErr(extractResult)) {
    if (extractResult.error.key !== "field-conflict") {
      log.debug("Markdown extraction failed for validation", {
        error: extractResult.error,
      });
      return diagnostics;
    }

    const conflictData = extractResult.error.data as
      | { fieldPath?: FieldPath }
      | undefined;
    const fieldPath = conflictData?.fieldPath ?? [];
    const range = resolveFieldRange(
      fieldPath,
      context.fieldMappings,
      context.frontmatter,
    );
    return [
      ...diagnostics,
      {
        range,
        severity: DiagnosticSeverity.Error,
        message:
          extractResult.error.message ?? "Conflicting field values detected",
        source: "binder",
        code: "field-conflict",
        data: conflictData,
      },
    ];
  }

  const extracted = extractResult.data;
  if (extracted.kind !== "document") return diagnostics;

  const fieldErrors = validateMarkdownFields({
    fieldset: extracted.entity,
    schema: context.schema,
    namespace: context.namespace,
  });

  for (const error of fieldErrors) {
    const range = resolveFieldRange(
      error.fieldPath,
      context.fieldMappings,
      context.frontmatter,
    );
    diagnostics.push({
      range,
      severity: DiagnosticSeverity.Error,
      message: error.message,
      source: "binder",
      code: error.code,
      data: { fieldPath: error.fieldPath },
    });
  }

  const relationRefs = collectRelationRefs(extracted.entity, context.schema);
  for (const { fieldPath, ref } of relationRefs) {
    const entityResult = await kg.fetchEntity(
      ref as never,
      undefined,
      context.namespace,
    );
    if (isErr(entityResult)) {
      const range = resolveFieldRange(
        fieldPath,
        context.fieldMappings,
        context.frontmatter,
      );
      diagnostics.push({
        range,
        severity: DiagnosticSeverity.Error,
        message: `Referenced entity '${ref}' not found`,
        source: "binder",
        code: "invalid-relation-reference",
        data: { fieldPath, ref },
      });
    }
  }

  return diagnostics;
};

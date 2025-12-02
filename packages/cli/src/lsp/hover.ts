import type {
  Hover,
  HoverParams,
  TextDocuments,
} from "vscode-languageserver/node";
import { MarkupKind } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { LineCounter } from "yaml";
import type { FieldAttrDef, FieldDef } from "@binder/db";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import {
  getPositionContext,
  type ParsedYaml,
  type YamlContext,
} from "../document/yaml-cst.ts";
import { formatWhenCondition } from "../utils/query.ts";
import type { DocumentCache } from "./document-cache.ts";
import {
  getDocumentContext,
  getFieldDefForType,
  lspPositionToYamlPosition,
  yamlRangeToLspRange,
} from "./lsp-utils.ts";

const buildConstraintsSection = (
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
): string => {
  const constraints: string[] = [];

  if (fieldDef.when)
    constraints.push(`When: ${formatWhenCondition(fieldDef.when)}`);
  if (attrs?.required) constraints.push("Required: yes");
  if (fieldDef.unique) constraints.push("Unique: yes");
  if (fieldDef.allowMultiple) constraints.push("Allow Multiple: yes");
  if (attrs?.default !== undefined)
    constraints.push(`Default: ${JSON.stringify(attrs.default)}`);

  if (constraints.length === 0) return "";

  return `\n\n---\n\n**Constraints:**\n${constraints.map((c) => `- ${c}`).join("\n")}`;
};

const buildRangeSection = (fieldDef: FieldDef): string => {
  if (fieldDef.dataType !== "relation" || !fieldDef.range) return "";
  return `\n\n**Range:** ${fieldDef.range.join(", ")}`;
};

const buildOptionsSection = (fieldDef: FieldDef): string => {
  if (fieldDef.dataType !== "option" || !fieldDef.options) return "";

  const optionsList = fieldDef.options
    .map((opt) => `- **${opt.key}**: ${opt.name}`)
    .join("\n");

  return `\n\n**Options:**\n${optionsList}`;
};

const buildFieldHover = (
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
  context: YamlContext,
  lineCounter: LineCounter,
): Hover => {
  const title = `**${fieldDef.name}** (${fieldDef.dataType})`;
  const description = fieldDef.description ? `\n\n${fieldDef.description}` : "";
  const constraints = buildConstraintsSection(fieldDef, attrs);
  const range = buildRangeSection(fieldDef);
  const options = buildOptionsSection(fieldDef);

  const content = `${title}${description}${constraints}${range}${options}`;

  if (!context.node || !("range" in context.node)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content,
      },
    };
  }

  const lspRange = yamlRangeToLspRange(context.node.range, lineCounter);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: content,
    },
    range: lspRange,
  };
};

export const handleHover = async (
  params: HoverParams,
  lspDocuments: TextDocuments<TextDocument>,
  documentCache: DocumentCache,
  runtime: RuntimeContextWithDb,
  log: Logger,
): Promise<Hover | null> => {
  const document = lspDocuments.get(params.textDocument.uri);
  if (!document) {
    log.debug("Document not found for hover", { uri: params.textDocument.uri });
    return null;
  }

  const context = await getDocumentContext(document, documentCache, runtime);
  if (!context) {
    log.debug("No document context for hover");
    return null;
  }

  const parsed = context.parsed as ParsedYaml;
  if (!parsed.doc || !parsed.lineCounter) {
    log.debug("Not a YAML document");
    return null;
  }

  const yamlPosition = lspPositionToYamlPosition(params.position);
  const yamlContext = getPositionContext(document.getText(), yamlPosition);

  if (!yamlContext || yamlContext.type !== "key") {
    log.debug("Not hovering over a field key");
    return null;
  }

  if (!yamlContext.node || !("value" in yamlContext.node)) {
    log.debug("Node is not a scalar");
    return null;
  }

  const fieldKey = String(yamlContext.node.value);

  const fieldInfo = getFieldDefForType(
    fieldKey as never,
    context.typeDef,
    context.schema,
  );
  if (!fieldInfo) {
    log.debug("Field not found in schema", { fieldKey });
    return null;
  }

  return buildFieldHover(
    fieldInfo.def,
    fieldInfo.attrs,
    yamlContext,
    parsed.lineCounter,
  );
};

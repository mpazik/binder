import type {
  Hover,
  HoverParams,
  Range as LspRange,
} from "vscode-languageserver/node";
import { MarkupKind } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
import type { FieldAttrDef, FieldDef } from "@binder/db";
import { type LspHandler } from "../document-context.ts";
import { getCursorContext } from "../cursor-context.ts";
import { findTemplate } from "../../document/navigation.ts";
import { formatWhenCondition } from "../../utils/query.ts";
import type { TemplateFormat } from "../../cli-config-schema.ts";

const buildHover = (content: string, range?: LspRange): Hover => ({
  contents: { kind: MarkupKind.Markdown, value: content },
  ...(range && { range }),
});

export type FieldHoverInput = {
  kind: "field";
  fieldDef: FieldDef;
  fieldAttrs?: FieldAttrDef;
  relationFieldDef?: FieldDef;
};
export type TemplateHoverInput = {
  kind: "template";
  templateKey: string;
  templateName?: string;
  templateDescription?: string;
  templateFormat?: TemplateFormat;
};
export type HoverInput = FieldHoverInput | TemplateHoverInput;

const renderConstraints = (
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

const renderRange = (fieldDef: FieldDef): string => {
  if (fieldDef.dataType !== "relation" || !fieldDef.range) return "";
  return `\n\n**Range:** ${fieldDef.range.join(", ")}`;
};

const renderOptions = (fieldDef: FieldDef): string => {
  if (fieldDef.dataType !== "option" || !fieldDef.options) return "";

  const optionsList = fieldDef.options
    .map((opt) =>
      opt.name ? `- **${opt.key}**: ${opt.name}` : `- **${opt.key}**`,
    )
    .join("\n");

  return `\n\n**Options:**\n${optionsList}`;
};

const renderRelationSource = (
  relationFieldDef: FieldDef | undefined,
): string => {
  if (!relationFieldDef) return "";
  return `\n\n**From:** ${relationFieldDef.name} (relation)`;
};

const renderFieldHover = (input: FieldHoverInput): string => {
  const { fieldDef, fieldAttrs, relationFieldDef } = input;

  const title = `**${fieldDef.name}** (${fieldDef.dataType})`;
  const description = fieldDef.description ? `\n\n${fieldDef.description}` : "";
  const relationSource = renderRelationSource(relationFieldDef);
  const constraints = renderConstraints(fieldDef, fieldAttrs);
  const range = renderRange(fieldDef);
  const options = renderOptions(fieldDef);

  return `${title}${description}${relationSource}${constraints}${range}${options}`;
};

const renderTemplateHover = (input: TemplateHoverInput): string => {
  const name = input.templateName ?? input.templateKey;
  const title = `**${name}** (template)`;
  const description = input.templateDescription
    ? `\n\n${input.templateDescription}`
    : "";

  return `${title}${description}`;
};

export const renderHoverContent = (input: HoverInput): string => {
  if (input.kind === "field") return renderFieldHover(input);
  return renderTemplateHover(input);
};

export const handleHover: LspHandler<HoverParams, Hover | null> = async (
  params,
  { context, runtime },
) => {
  const cursorContext = getCursorContext(context, params.position);

  if (cursorContext.type === "none") return null;

  if (
    cursorContext.type === "field-key" ||
    cursorContext.type === "field-value"
  ) {
    const relationFieldDef =
      cursorContext.fieldPath.length > 1
        ? context.schema.fields[cursorContext.fieldPath[0]!]
        : undefined;
    const content = renderHoverContent({
      kind: "field",
      fieldDef: cursorContext.fieldDef,
      fieldAttrs: cursorContext.fieldAttrs,
      relationFieldDef,
    });
    return buildHover(content, cursorContext.range);
  }

  if (cursorContext.type === "template") {
    const templatesResult = await runtime.templates();
    if (isErr(templatesResult)) return null;

    const template = findTemplate(
      templatesResult.data,
      cursorContext.templateKey,
    );
    const content = renderHoverContent({
      kind: "template",
      templateKey: cursorContext.templateKey,
      templateName: template.name,
      templateDescription: template.description,
      templateFormat: template.templateFormat,
    });
    return buildHover(content);
  }

  return null;
};

import type {
  Hover,
  HoverParams,
  Range as LspRange,
} from "vscode-languageserver/node";
import { MarkupKind } from "vscode-languageserver/node";
import type { FieldAttrDef, FieldDef } from "@binder/db";
import { formatWhenCondition } from "../../utils/query.ts";
import { type LspHandler } from "../document-context.ts";
import { getCursorContext } from "../cursor-context.ts";

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

const buildHoverContent = (
  fieldDef: FieldDef,
  attrs: FieldAttrDef | undefined,
): string => {
  const title = `**${fieldDef.name}** (${fieldDef.dataType})`;
  const description = fieldDef.description ? `\n\n${fieldDef.description}` : "";
  const constraints = buildConstraintsSection(fieldDef, attrs);
  const range = buildRangeSection(fieldDef);
  const options = buildOptionsSection(fieldDef);

  return `${title}${description}${constraints}${range}${options}`;
};

const buildHover = (content: string, range?: LspRange): Hover => ({
  contents: { kind: MarkupKind.Markdown, value: content },
  ...(range && { range }),
});

export const handleHover: LspHandler<HoverParams, Hover | null> = (
  params,
  { context },
) => {
  const cursorContext = getCursorContext(context, params.position);

  if (cursorContext.type === "none" || cursorContext.type === "template")
    return null;

  const content = buildHoverContent(
    cursorContext.fieldDef,
    cursorContext.fieldAttrs,
  );

  return buildHover(content, cursorContext.range);
};

import type {
  Hover,
  HoverParams,
  Range as LspRange,
} from "vscode-languageserver/node";
import { MarkupKind } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
import type { EntityRef, FieldAttrDef, FieldDef } from "@binder/repo";
import { type LspHandler } from "../document-context.ts";
import { getCursorContext } from "../cursor-context.ts";
import { findView } from "../../document/navigation.ts";
import { formatWhenCondition } from "../../utils/query.ts";
import type { ViewFormat } from "../../cli-config-schema.ts";

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
export type EntityHoverInput = {
  kind: "entity";
  key?: string;
  name?: string;
  title?: string;
  description?: string;
  typeName?: string;
};
export type ViewHoverInput = {
  kind: "view";
  viewKey: string;
  viewName?: string;
  viewDescription?: string;
  viewFormat?: ViewFormat;
};
export type HoverInput = FieldHoverInput | EntityHoverInput | ViewHoverInput;

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

const renderEntityHover = (input: EntityHoverInput): string => {
  const parts: string[] = [];

  const hasKey = !!input.key;
  const hasType = !!input.typeName;
  if (hasKey && hasType) parts.push(`\`${input.key}\`: *${input.typeName}*`);
  else if (hasKey) parts.push(`\`${input.key}\``);
  else if (hasType) parts.push(`*${input.typeName}*`);

  const displayName = input.title ?? input.name;
  if (displayName) parts.push(`**${displayName}**`);

  if (input.description) parts.push(input.description);

  return parts.join("\n\n");
};

const renderViewHover = (input: ViewHoverInput): string => {
  const name = input.viewName ?? input.viewKey;
  const title = `**${name}** (view)`;
  const description = input.viewDescription
    ? `\n\n${input.viewDescription}`
    : "";

  return `${title}${description}`;
};

export const renderHoverContent = (input: HoverInput): string => {
  if (input.kind === "field") return renderFieldHover(input);
  if (input.kind === "entity") return renderEntityHover(input);
  return renderViewHover(input);
};

export const handleHover: LspHandler<HoverParams, Hover | null> = async (
  params,
  { context, runtime },
) => {
  const cursorContext = getCursorContext(context, params.position);

  if (cursorContext.type === "none") return null;

  if (
    cursorContext.type === "field-key" ||
    cursorContext.type === "field-value" ||
    cursorContext.type === "frontmatter-field-key" ||
    cursorContext.type === "frontmatter-field-value"
  ) {
    if (
      (cursorContext.type === "field-value" ||
        cursorContext.type === "frontmatter-field-value") &&
      cursorContext.fieldDef.dataType === "relation" &&
      cursorContext.currentValue
    ) {
      const ref = cursorContext.currentValue as EntityRef;
      const result = await runtime.kg.fetchEntity(ref);
      if (isErr(result)) {
        runtime.log.warn(
          `hover: failed to fetch entity "${cursorContext.currentValue}"`,
          result.error,
        );
      } else {
        const entity = result.data;
        const content = renderHoverContent({
          kind: "entity",
          key: entity.key as string | undefined,
          name: entity.name as string | undefined,
          title: entity.title as string | undefined,
          description: entity.description as string | undefined,
          typeName: entity.type as string | undefined,
        });
        return buildHover(content, cursorContext.range);
      }
    }

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

  if (cursorContext.type === "view") {
    const viewsResult = await runtime.views();
    if (isErr(viewsResult)) return null;

    const viewEntity = findView(viewsResult.data, cursorContext.viewKey);
    const content = renderHoverContent({
      kind: "view",
      viewKey: cursorContext.viewKey,
      viewName: viewEntity.name,
      viewDescription: viewEntity.description,
      viewFormat: viewEntity.viewFormat,
    });
    return buildHover(content);
  }

  return null;
};

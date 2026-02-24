import {
  buildIncludes,
  getDelimiterString,
  type Includes,
  type KnowledgeGraph,
  mergeIncludes,
  richtextFormats,
} from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import { visit } from "unist-util-visit";
import { type TemplateFormat } from "../cli-config-schema.ts";
import {
  extractFieldPathsFromAst,
  parseTemplate,
  type TemplateAST,
  type TemplateFieldSlot,
} from "./template.ts";
import {
  BLOCK_TEMPLATE_KEY,
  DOCUMENT_TEMPLATE_KEY,
  LINE_TEMPLATE_KEY,
  PHRASE_TEMPLATE_KEY,
  SECTION_TEMPLATE_KEY,
  TEMPLATE_TEMPLATE_KEY,
  type TemplateKey,
} from "./template.const.ts";

export {
  type TemplateKey,
  TEMPLATE_TEMPLATE_KEY,
  PHRASE_TEMPLATE_KEY,
  LINE_TEMPLATE_KEY,
  BLOCK_TEMPLATE_KEY,
  SECTION_TEMPLATE_KEY,
  DOCUMENT_TEMPLATE_KEY,
} from "./template.const.ts";

export type TemplateEntity = {
  key: TemplateKey;
  name?: string;
  description?: string;
  preamble?: string[];
  templateFormat?: TemplateFormat;
  templateContent: string;
  templateAst: TemplateAST;
  templateIncludes: Includes | undefined;
};

const buildPreambleIncludes = (
  preamble: string[] | undefined,
): Includes | undefined => {
  if (!preamble || preamble.length === 0) return undefined;
  return buildIncludes(preamble.map((key) => [key]));
};

export const createTemplateEntity = (
  key: string,
  templateContent: string,
  options?: Partial<TemplateEntity>,
): TemplateEntity => {
  const templateAst = parseTemplate(templateContent);
  const astIncludes = buildIncludes(extractFieldPathsFromAst(templateAst));
  const preambleIncludes = buildPreambleIncludes(options?.preamble);
  return {
    key: key as TemplateKey,
    templateContent,
    templateAst,
    templateIncludes: mergeIncludes(astIncludes, preambleIncludes),
    ...options,
  };
};

export type Templates = TemplateEntity[];

type BuiltinTemplate = readonly [
  string,
  string,
  Partial<Pick<TemplateEntity, "templateFormat" | "preamble">>?,
];

const TEMPLATE_PREAMBLE_KEYS = [
  "key",
  "name",
  "description",
  "templateFormat",
  "preamble",
];

const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  [
    TEMPLATE_TEMPLATE_KEY,
    `{templateContent}`,
    { preamble: TEMPLATE_PREAMBLE_KEYS },
  ],
  [PHRASE_TEMPLATE_KEY, `{title}`, { templateFormat: "phrase" }],
  [
    LINE_TEMPLATE_KEY,
    `- **{title}**: {description}`,
    { templateFormat: "line" },
  ],
  [
    BLOCK_TEMPLATE_KEY,
    `**{title}**\n\n{description}`,
    { templateFormat: "block" },
  ],
  [
    SECTION_TEMPLATE_KEY,
    `### {title}\n\n{description}`,
    { templateFormat: "section" },
  ],
  [
    DOCUMENT_TEMPLATE_KEY,
    `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
    { templateFormat: "document" },
  ],
];

const resolveNestedTemplateIncludes = (
  template: TemplateEntity,
  templates: Templates,
  visited: Set<string>,
): Includes | undefined => {
  if (visited.has(template.key)) return template.templateIncludes;
  visited.add(template.key);

  let includes = template.templateIncludes;

  visit(template.templateAst, "fieldSlot", (node: TemplateFieldSlot) => {
    const fieldKey = node.path[0];
    if (!fieldKey) return;

    // Include where: filter field keys in the relation's includes
    const whereStr = node.props?.where;
    if (typeof whereStr === "string") {
      const whereKeys = whereStr
        .split(/\s+AND\s+|,/)
        .map((p) => p.trim().split("=")[0]?.trim())
        .filter(Boolean) as string[];
      if (whereKeys.length > 0) {
        const whereIncludes = buildIncludes(whereKeys.map((k) => [k]));
        if (whereIncludes)
          includes = mergeIncludes(includes, {
            [fieldKey]: whereIncludes,
          });
      }
    }

    const nestedTemplateKey = node.props?.template;
    if (!nestedTemplateKey) return;

    const nestedTemplate = templates.find((t) => t.key === nestedTemplateKey);
    if (!nestedTemplate) return;

    const nestedIncludes = resolveNestedTemplateIncludes(
      nestedTemplate,
      templates,
      visited,
    );
    if (!nestedIncludes) return;

    // Build includes for the relation field with nested template's includes
    const relationIncludes: Includes = { [fieldKey]: nestedIncludes };
    includes = mergeIncludes(includes, relationIncludes);
  });

  return includes;
};

const resolveAllTemplateIncludes = (templates: Templates): void => {
  for (const template of templates) {
    template.templateIncludes = resolveNestedTemplateIncludes(
      template,
      templates,
      new Set(),
    );
  }
};

export const loadTemplates = async (
  kg: KnowledgeGraph,
): ResultAsync<Templates> => {
  const searchResult = await kg.search(
    { filters: { type: "Template" } },
    "config",
  );
  if (isErr(searchResult)) return searchResult;

  const builtinTemplates = BUILTIN_TEMPLATES.map(([key, content, options]) =>
    createTemplateEntity(key, content, options ?? {}),
  );

  const delimiter = getDelimiterString(richtextFormats["document"].delimiter);
  const templates: Templates = searchResult.data.items.map((item) => {
    const content = item.templateContent;
    const templateContent = Array.isArray(content)
      ? content.join(delimiter)
      : (content as string);

    return createTemplateEntity(item.key as string, templateContent, {
      name: item.name as string | undefined,
      description: item.description as string | undefined,
      preamble: item.preamble as string[] | undefined,
      templateFormat: item.templateFormat as TemplateFormat | undefined,
    });
  });

  const allTemplates = [...builtinTemplates, ...templates];
  resolveAllTemplateIncludes(allTemplates);

  return ok(allTemplates);
};

export type TemplateLoader = () => ResultAsync<Templates>;
export type TemplateCache = {
  load: TemplateLoader;
  invalidate: () => void;
};

export const createTemplateCache = (kg: KnowledgeGraph): TemplateCache => {
  let cache: Templates | null = null;

  return {
    load: async () => {
      if (cache) return ok(cache);

      const result = await loadTemplates(kg);
      if (isErr(result)) return result;

      cache = result.data;
      return result;
    },
    invalidate: () => {
      cache = null;
    },
  };
};

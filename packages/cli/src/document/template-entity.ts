import {
  buildIncludes,
  type Includes,
  type KnowledgeGraph,
  mergeIncludes,
} from "@binder/db";
import { type Brand, isErr, ok, type ResultAsync } from "@binder/utils";
import { visit } from "unist-util-visit";
import { type TemplateFormat } from "../cli-config-schema.ts";
import {
  extractFieldPathsFromAst,
  parseTemplate,
  type TemplateAST,
  type TemplateFieldSlot,
} from "./template.ts";

export type TemplateKey = Brand<string, "TemplateKey">;
export const TEMPLATE_TEMPLATE_KEY = "__template__" as TemplateKey;
export const PHRASE_TEMPLATE_KEY = "__inline__" as TemplateKey;
export const LINE_TEMPLATE_KEY = "__line__" as TemplateKey;
export const BLOCK_TEMPLATE_KEY = "__block__" as TemplateKey;
export const SECTION_TEMPLATE_KEY = "__section__" as TemplateKey;
export const DOCUMENT_TEMPLATE_KEY = "__document__" as TemplateKey;

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

export const createTemplateEntity = (
  key: string,
  templateContent: string,
  options?: Partial<TemplateEntity>,
): TemplateEntity => {
  const templateAst = parseTemplate(templateContent);
  return {
    key: key as TemplateKey,
    templateContent,
    templateAst,
    templateIncludes: buildIncludes(extractFieldPathsFromAst(templateAst)),
    ...options,
  };
};

export type Templates = TemplateEntity[];

type BuiltinTemplate = readonly [string, string, TemplateFormat?];

const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  [TEMPLATE_TEMPLATE_KEY, `{templateContent}`],
  [PHRASE_TEMPLATE_KEY, `{title}`, "phrase"],
  [LINE_TEMPLATE_KEY, `- **{title}**: {description}`, "line"],
  [BLOCK_TEMPLATE_KEY, `**{title}**\n\n{description}`, "block"],
  [SECTION_TEMPLATE_KEY, `### {title}\n\n{description}`, "section"],
  [
    DOCUMENT_TEMPLATE_KEY,
    `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
    "document",
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
    const fieldKey = node.path[0];
    if (!fieldKey) return;

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

  const builtinTemplates = BUILTIN_TEMPLATES.map(([key, content, format]) =>
    createTemplateEntity(
      key,
      content,
      format ? { templateFormat: format } : {},
    ),
  );

  const templates: Templates = searchResult.data.items.map((item) =>
    createTemplateEntity(item.key as string, item.templateContent as string, {
      name: item.name as string | undefined,
      description: item.description as string | undefined,
      preamble: item.preamble as string[] | undefined,
      templateFormat: item.templateFormat as TemplateFormat | undefined,
    }),
  );

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

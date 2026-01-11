import {
  buildIncludes,
  type Includes,
  type KnowledgeGraph,
  parseFieldPath,
} from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import {
  extractFieldSlotsFromAst,
  parseTemplate,
  type TemplateAST,
} from "./template.ts";

export const SYSTEM_TEMPLATE_KEY = "__system__";
export const DEFAULT_TEMPLATE_KEY = "__default__";

export const createTemplateEntity = (
  key: string,
  templateContent: string,
  options?: Partial<TemplateEntity>,
): TemplateEntity => {
  const templateAst = parseTemplate(templateContent);
  return {
    key,
    templateContent,
    templateAst,
    templateIncludes: buildIncludes(
      extractFieldSlotsFromAst(templateAst).map(parseFieldPath),
    ),
    ...options,
  };
};

const BUILTIN_TEMPLATES: Templates = [
  createTemplateEntity(SYSTEM_TEMPLATE_KEY, `{templateContent}`),
  createTemplateEntity(
    DEFAULT_TEMPLATE_KEY,
    `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
  ),
];

export type TemplateEntity = {
  key: string;
  name?: string;
  description?: string;
  preamble?: string[];
  templateContent: string;
  templateAst: TemplateAST;
  templateIncludes: Includes | undefined;
};

export type Templates = TemplateEntity[];

export const loadTemplates = async (
  kg: KnowledgeGraph,
): ResultAsync<Templates> => {
  const searchResult = await kg.search(
    { filters: { type: "Template" } },
    "config",
  );
  if (isErr(searchResult)) return searchResult;

  const templates: Templates = searchResult.data.items.map((item) =>
    createTemplateEntity(item.key as string, item.templateContent as string, {
      name: item.name as string | undefined,
      description: item.description as string | undefined,
      preamble: item.preamble as string[] | undefined,
    }),
  );

  return ok([...BUILTIN_TEMPLATES, ...templates]);
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

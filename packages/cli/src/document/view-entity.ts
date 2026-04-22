import {
  buildIncludes,
  getDelimiterString,
  type Includes,
  type KnowledgeGraph,
  mergeIncludes,
  richtextFormats,
} from "@binder/repo";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import { visit } from "unist-util-visit";
import { type ViewFormat } from "../cli-config-schema.ts";
import {
  extractFieldPathsFromAst,
  parseView,
  type ViewAST,
  type ViewFieldSlot,
} from "./view.ts";
import {
  BLOCK_VIEW_KEY,
  DOCUMENT_VIEW_KEY,
  LINE_VIEW_KEY,
  PHRASE_VIEW_KEY,
  SECTION_VIEW_KEY,
  VIEW_VIEW_KEY,
  type ViewKey,
} from "./view.const.ts";

export {
  type ViewKey,
  VIEW_VIEW_KEY,
  PHRASE_VIEW_KEY,
  LINE_VIEW_KEY,
  BLOCK_VIEW_KEY,
  SECTION_VIEW_KEY,
  DOCUMENT_VIEW_KEY,
} from "./view.const.ts";

export type ViewEntity = {
  key: ViewKey;
  name?: string;
  description?: string;
  preamble?: string[];
  viewFormat?: ViewFormat;
  viewContent: string;
  viewAst: ViewAST;
  viewIncludes: Includes | undefined;
};

const buildPreambleIncludes = (
  preamble: string[] | undefined,
): Includes | undefined => {
  if (!preamble || preamble.length === 0) return undefined;
  return buildIncludes(preamble.map((key) => [key]));
};

export const createViewEntity = (
  key: string,
  viewContent: string,
  options?: Partial<ViewEntity>,
): ViewEntity => {
  const viewAst = parseView(viewContent);
  const astIncludes = buildIncludes(extractFieldPathsFromAst(viewAst));
  const preambleIncludes = buildPreambleIncludes(options?.preamble);
  return {
    key: key as ViewKey,
    viewContent,
    viewAst,
    viewIncludes: mergeIncludes(astIncludes, preambleIncludes),
    ...options,
  };
};

export type Views = ViewEntity[];

type BuiltinView = readonly [
  string,
  string,
  Partial<Pick<ViewEntity, "viewFormat" | "preamble">>?,
];

const VIEW_PREAMBLE_KEYS = [
  "key",
  "name",
  "description",
  "viewFormat",
  "preamble",
];

const BUILTIN_VIEWS: readonly BuiltinView[] = [
  [VIEW_VIEW_KEY, `{viewContent}`, { preamble: VIEW_PREAMBLE_KEYS }],
  [PHRASE_VIEW_KEY, `{title}`, { viewFormat: "phrase" }],
  [LINE_VIEW_KEY, `- **{title}**: {description}`, { viewFormat: "line" }],
  [BLOCK_VIEW_KEY, `**{title}**\n\n{description}`, { viewFormat: "block" }],
  [SECTION_VIEW_KEY, `### {title}\n\n{description}`, { viewFormat: "section" }],
  [
    DOCUMENT_VIEW_KEY,
    `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
    { viewFormat: "document" },
  ],
];

const resolveNestedViewIncludes = (
  view: ViewEntity,
  views: Views,
  visited: Set<string>,
): Includes | undefined => {
  if (visited.has(view.key)) return view.viewIncludes;
  visited.add(view.key);

  let includes = view.viewIncludes;

  visit(view.viewAst, "fieldSlot", (node: ViewFieldSlot) => {
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

    const nestedViewKey = node.props?.view;
    if (!nestedViewKey) return;

    const nestedView = views.find((t) => t.key === nestedViewKey);
    if (!nestedView) return;

    const nestedIncludes = resolveNestedViewIncludes(
      nestedView,
      views,
      visited,
    );
    if (!nestedIncludes) return;

    // Build includes for the relation field with nested view's includes
    const relationIncludes: Includes = { [fieldKey]: nestedIncludes };
    includes = mergeIncludes(includes, relationIncludes);
  });

  return includes;
};

const resolveAllViewIncludes = (views: Views): void => {
  for (const entry of views) {
    entry.viewIncludes = resolveNestedViewIncludes(entry, views, new Set());
  }
};

export const loadViews = async (kg: KnowledgeGraph): ResultAsync<Views> => {
  const searchResult = await kg.search({ filters: { type: "View" } }, "config");
  if (isErr(searchResult)) return searchResult;

  const builtinViews = BUILTIN_VIEWS.map(([key, content, options]) =>
    createViewEntity(key, content, options ?? {}),
  );

  const delimiter = getDelimiterString(richtextFormats["document"].delimiter);
  const views: Views = searchResult.data.items.map((item) => {
    const content = item.viewContent;
    const viewContent = Array.isArray(content)
      ? content.join(delimiter)
      : (content as string);

    return createViewEntity(item.key as string, viewContent, {
      name: item.name as string | undefined,
      description: item.description as string | undefined,
      preamble: item.preamble as string[] | undefined,
      viewFormat: item.viewFormat as ViewFormat | undefined,
    });
  });

  const allViews = [...builtinViews, ...views];
  resolveAllViewIncludes(allViews);

  return ok(allViews);
};

export type ViewLoader = () => ResultAsync<Views>;
export type ViewCache = {
  load: ViewLoader;
  invalidate: () => void;
};

export const createViewCache = (kg: KnowledgeGraph): ViewCache => {
  let cache: Views | null = null;

  return {
    load: async () => {
      if (cache) return ok(cache);

      const result = await loadViews(kg);
      if (isErr(result)) return result;

      cache = result.data;
      return result;
    },
    invalidate: () => {
      cache = null;
    },
  };
};

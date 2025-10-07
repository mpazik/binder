import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import type { Fieldset, KnowledgeGraph, NodeUid } from "@binder/db";
import {
  errorToObject,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { sanitizeFilename } from "../utils/file.ts";
import { Log } from "../log.ts";
import { parseStringQuery } from "./query.ts";
import { buildAstDoc } from "./doc-builder.ts";
import { renderAstToMarkdown } from "./markdown.ts";
import {
  compileTemplate,
  DEFAULT_DYNAMIC_TEMPLATE,
  renderTemplate,
} from "./template.ts";

const resolvePath = (template: string, item: Fieldset): string => {
  return template.replace(/\{(\w+)\}/g, (match, fieldName) => {
    const value = item[fieldName];

    if (value === null || value === undefined) {
      if (fieldName === "key") {
        return item.uid as string;
      }
      return match;
    }

    if (typeof value === "string") {
      return sanitizeFilename(value);
    }

    return sanitizeFilename(String(value));
  });
};

export const renderItem = async (
  kg: KnowledgeGraph,
  item: Fieldset,
  template?: string,
): ResultAsync<string> => {
  if (template) {
    const templateResult = compileTemplate(template);
    if (isErr(templateResult)) return templateResult;
    return renderTemplate(templateResult.data, item);
  } else if (item.type === "Document") {
    const astResult = await buildAstDoc(kg, item.uid as NodeUid);
    if (isErr(astResult)) return astResult;
    return ok(renderAstToMarkdown(astResult.data));
  } else {
    return renderTemplate(DEFAULT_DYNAMIC_TEMPLATE, item);
  }
};

export const renderDynamicDirectory = async (
  kg: KnowledgeGraph,
  docsPath: string,
  dynamicDir: { path: string; query: string; template?: string },
): ResultAsync<void> => {
  const queryParams = parseStringQuery(dynamicDir.query);
  const searchResult = await kg.search(queryParams);

  if (isErr(searchResult)) {
    Log.error(`Failed to execute query for dynamic directory`, {
      query: dynamicDir.query,
      error: searchResult.error,
    });
    return ok(undefined);
  }

  const items = searchResult.data.items;

  for (const item of items) {
    const markdownResult = await renderItem(kg, item, dynamicDir.template);

    if (isErr(markdownResult)) {
      Log.error(`Failed to render item`, {
        uid: item.uid,
        error: markdownResult.error,
      });
      continue;
    }

    const markdown = markdownResult.data;
    const resolvedPath = resolvePath(dynamicDir.path, item);
    const filePath = join(docsPath, resolvedPath);

    const writeResult = tryCatch(() => {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, markdown, "utf-8");
    }, errorToObject);

    if (isErr(writeResult)) {
      Log.error(`Failed to write dynamic document`, {
        path: filePath,
        error: writeResult.error,
      });
    }
  }

  return ok(undefined);
};

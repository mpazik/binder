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
const renderSimpleTemplate = (item: Fieldset): string => {
  const lines: string[] = [];
  const title = item.title as string | undefined;
  const type = item.type as string;

  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }

  lines.push(`**Type:** ${type}`);
  lines.push(`**UID:** ${item.uid}`);

  if (item.key) {
    lines.push(`**Key:** ${item.key}`);
  }

  lines.push("");
  lines.push("## Fields");
  lines.push("");

  const excludeFields = new Set(["id", "uid", "key", "type", "title"]);

  for (const [key, value] of Object.entries(item)) {
    if (excludeFields.has(key)) continue;
    if (value === null || value === undefined) continue;

    lines.push(`- **${key}:** ${value}`);
  }

  return lines.join("\n");
};
export const renderDynamicDirectory = async (
  kg: KnowledgeGraph,
  docsPath: string,
  dynamicDir: { path: string; query: string },
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
    let markdown: string;

    if (item.type === "Document") {
      const astResult = await buildAstDoc(kg, item.uid as NodeUid);
      if (isErr(astResult)) {
        Log.error(`Failed to build AST for dynamic document`, {
          uid: item.uid,
          error: astResult.error,
        });
        continue;
      }
      markdown = renderAstToMarkdown(astResult.data);
    } else {
      markdown = renderSimpleTemplate(item);
    }

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

import * as YAML from "yaml";
import {
  createError,
  err,
  isErr,
  ok,
  pick,
  type ResultAsync,
} from "@binder/utils";
import type {
  Fieldset,
  KnowledgeGraph,
  NodeRef,
  QueryParams,
} from "@binder/db";
import type { SlimAST } from "./markdown.ts";

const parseDataviewQuery = (query: string): QueryParams => {
  const filters: Record<string, string> = {};
  const pairs = query.split(",").map((p) => p.trim());
  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s) => s.trim());
    if (field && value) {
      filters[field] = value;
    }
  }
  return { filters };
};

export const buildAstDoc = async (
  kg: KnowledgeGraph,
  documentRef: NodeRef,
): ResultAsync<SlimAST> => {
  const diagnostics: string[] = [];

  const documentResult = await kg.fetchNode(documentRef);
  if (isErr(documentResult)) return documentResult;

  const document = documentResult.data;
  if (document.type !== "Document") {
    diagnostics.push("Node is not a Document");
    return err(
      createError("render_failed", "Failed to render AST", {
        documentRef,
        diagnostics,
      }),
    );
  }

  const nodesMap = new Map<string, Fieldset>([
    [document.uid as string, document],
  ]);

  const fetchChildNodes = async (node: Fieldset): ResultAsync<void> => {
    const blockContent = node.blockContent as string[] | undefined;
    if (!blockContent) return ok(undefined);

    for (const uid of blockContent) {
      if (nodesMap.has(uid)) continue;

      const childResult = await kg.fetchNode(uid as NodeRef);
      if (isErr(childResult)) {
        diagnostics.push(`Failed to fetch node ${uid}`);
        continue;
      }

      nodesMap.set(uid, childResult.data);
      await fetchChildNodes(childResult.data);
    }

    return ok(undefined);
  };

  const fetchResult = await fetchChildNodes(document);
  if (isErr(fetchResult)) return fetchResult;

  const renderNodeFlat = async (
    node: Fieldset,
    depth: number,
  ): Promise<any[]> => {
    const nodeType = node.type as string;

    switch (nodeType) {
      case "Document": {
        const children: any[] = [];
        let sectionDepth = 1;
        const blockContent = (node.blockContent as string[]) || [];
        for (const uid of blockContent) {
          const child = nodesMap.get(uid)!;
          const childType = child.type as string;
          if (childType === "Section") {
            children.push(...(await renderNodeFlat(child, sectionDepth)));
            sectionDepth = 2;
          } else {
            children.push(...(await renderNodeFlat(child, 1)));
          }
        }
        return children;
      }
      case "Section": {
        const blockContent = (node.blockContent as string[]) || [];
        const childrenArrays = await Promise.all(
          blockContent.map((uid) => renderNodeFlat(nodesMap.get(uid)!, depth)),
        );
        return [
          {
            type: "heading",
            depth,
            children: [{ type: "text", value: node.title as string }],
          },
          ...childrenArrays.flat(),
        ];
      }
      case "Paragraph":
        return [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: node.textContent as string,
              },
            ],
          },
        ];
      case "List": {
        const blockContent = (node.blockContent as string[]) || [];
        const childrenArrays = await Promise.all(
          blockContent.map((uid) => renderNodeFlat(nodesMap.get(uid)!, depth)),
        );
        return [
          {
            type: "list",
            ordered: false,
            start: null,
            spread: false,
            children: childrenArrays.flat(),
          },
        ];
      }
      case "ListItem":
        return [
          {
            type: "listItem",
            spread: false,
            checked: null,
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    value: node.textContent as string,
                  },
                ],
              },
            ],
          },
        ];
      case "Dataview": {
        const queryParams = parseDataviewQuery(node.query as string);
        const searchResult = await kg.search(queryParams);

        if (isErr(searchResult)) {
          diagnostics.push(
            `Dataview query failed: ${searchResult.error.message}`,
          );
          return [
            {
              type: "html",
              value: `<dataview query="${node.query}" error="true"></dataview>`,
            },
          ];
        }

        const yamlContent = YAML.stringify(
          searchResult.data.items.map((it) =>
            pick(it, ["title", "description"]),
          ),
        );
        return [
          {
            type: "html",
            value: `<dataview query="${node.query}">\n${yamlContent}</dataview>`,
          },
        ];
      }
      default:
        return [];
    }
  };

  const children = await renderNodeFlat(document, 1);

  return ok({
    type: "root",
    children,
  } as SlimAST);
};

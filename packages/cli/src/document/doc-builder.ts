import * as YAML from "yaml";
import {
  createError,
  err,
  isErr,
  ok,
  pick,
  type Result,
  type ResultAsync,
} from "@binder/utils";
import type {
  Fieldset,
  FieldsetNested,
  KnowledgeGraph,
  NodeRef,
} from "@binder/db";
import { Log } from "../log.ts";
import type { SlimAST } from "./markdown.ts";
import { parseStringQuery } from "./query.ts";
import {
  compileTemplate,
  DEFAULT_DATAVIEW_TEMPLATE,
  DEFAULT_DATAVIEW_TEMPLATE_STRING,
  extractFieldsFromRenderedItems,
  renderTemplateForItems,
} from "./template.ts";

export const fetchDocumentNodes = async (
  kg: KnowledgeGraph,
  documentRef: NodeRef,
): ResultAsync<FieldsetNested> => {
  const documentResult = await kg.fetchNode(documentRef);
  if (isErr(documentResult)) return documentResult;

  const document = documentResult.data;
  if (document.type !== "Document") {
    return err(
      createError("not_a_document", "Node is not a Document", {
        documentRef,
      }),
    );
  }

  const buildNestedNode = async (node: Fieldset): Promise<FieldsetNested> => {
    if (node.type === "Dataview") {
      const queryParams = parseStringQuery(node.query as string);
      const searchResult = await kg.search(queryParams);
      const data = isErr(searchResult) ? [] : searchResult.data.items;
      return { ...node, data };
    }

    const blockContent = node.blockContent as string[] | undefined;
    if (!blockContent || blockContent.length === 0) {
      return node;
    }

    const nestedBlockContent = await Promise.all(
      blockContent.map(async (uid) => {
        const childResult = await kg.fetchNode(uid as NodeRef);
        if (isErr(childResult)) return null;
        return buildNestedNode(childResult.data);
      }),
    );

    return {
      ...node,
      blockContent: nestedBlockContent.filter(
        (n): n is FieldsetNested => n !== null,
      ),
    };
  };

  const nestedDocument = await buildNestedNode(document);
  return ok(nestedDocument);
};

export const buildAstDoc = async (
  kg: KnowledgeGraph,
  documentRef: NodeRef,
): ResultAsync<SlimAST> => {
  const documentResult = await fetchDocumentNodes(kg, documentRef);
  if (isErr(documentResult)) return documentResult;

  const document = documentResult.data;

  const renderNodeFlat = async (
    node: FieldsetNested,
    depth: number,
  ): Promise<any[]> => {
    const nodeType = node.type as string;

    switch (nodeType) {
      case "Document": {
        const children: any[] = [];
        let sectionDepth = 1;
        const blockContent = (node.blockContent as FieldsetNested[]) || [];
        for (const child of blockContent) {
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
        const blockContent = (node.blockContent as FieldsetNested[]) || [];
        const childrenArrays = await Promise.all(
          blockContent.map((child) => renderNodeFlat(child, depth)),
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
        const blockContent = (node.blockContent as FieldsetNested[]) || [];
        const childrenArrays = await Promise.all(
          blockContent.map((child) => renderNodeFlat(child, depth)),
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
        const data = (node.data as Fieldset[]) || [];
        const queryParams = parseStringQuery(node.query as string);
        const searchResult = await kg.search(queryParams);

        const templateAttr = node.template
          ? ` template="${node.template}"`
          : "";

        if (isErr(searchResult)) {
          return [
            {
              type: "html",
              value: `<dataview query="${node.query}"${templateAttr} error="true"></dataview>`,
            },
          ];
        }

        const template = (() => {
          if (node.template) {
            const compileResult = compileTemplate(node.template as string);
            if (isErr(compileResult)) {
              Log.error(
                `Dataview template compile failed: ${compileResult.error.message}`,
              );
              return DEFAULT_DATAVIEW_TEMPLATE;
            }
            return compileResult.data;
          }
          return DEFAULT_DATAVIEW_TEMPLATE;
        })();
        const renderResult = renderTemplateForItems(template, data);

        if (isErr(renderResult)) {
          const yamlContent = YAML.stringify(
            data.map((it) => pick(it, ["title", "description"])),
          );
          return [
            {
              type: "html",
              value: `<dataview query="${node.query}"${templateAttr}>\n${yamlContent}</dataview>`,
            },
          ];
        }

        const content = renderResult.data ? renderResult.data + "\n" : "";
        return [
          {
            type: "html",
            value: `<dataview query="${node.query}"${templateAttr}>\n${content}</dataview>`,
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

const extractTextValue = (node: any): string => {
  if (!node.children || node.children.length === 0) return "";
  return node.children[0].value || "";
};

const parseDataviewQuery = (htmlValue: string): string | null => {
  const match = htmlValue.match(/<dataview\s+query="([^"]*)"/);
  return match ? match[1] : null;
};

const parseDataviewTemplate = (htmlValue: string): string | null => {
  const match = htmlValue.match(/template="([^"]*)"/);
  return match ? match[1] : null;
};

const parseDataviewContent = (htmlValue: string): string => {
  const match = htmlValue.match(/<dataview[^>]*>\n?(.*?)<\/dataview>/s);
  return match ? match[1].trim() : "";
};

export const deconstructAstDocument = (ast: SlimAST): Result<Fieldset> => {
  const document: Fieldset = { type: "Document", blockContent: [] };
  let currentSection: Fieldset | null = null;

  for (const node of ast.children as any[]) {
    const currentParent = currentSection || document;

    switch (node.type) {
      case "heading": {
        const section: Fieldset = {
          type: "Section",
          title: extractTextValue(node),
          blockContent: [],
        };
        (document.blockContent as Fieldset[]).push(section);
        currentSection = section;
        break;
      }
      case "paragraph": {
        const paragraph: Fieldset = {
          type: "Paragraph",
          textContent: extractTextValue(node),
        };
        (currentParent.blockContent as Fieldset[]).push(paragraph);
        break;
      }
      case "list": {
        const list: Fieldset = {
          type: "List",
          blockContent: (node.children || []).map((listItemNode: any) => ({
            type: "ListItem",
            textContent: extractTextValue(listItemNode.children?.[0] || {}),
          })),
        };
        (currentParent.blockContent as Fieldset[]).push(list);
        break;
      }
      case "html": {
        const query = parseDataviewQuery(node.value);
        if (query) {
          const dataview: Fieldset = { type: "Dataview", query };
          const template = parseDataviewTemplate(node.value);
          if (template) {
            dataview.template = template;
          }
          const content = parseDataviewContent(node.value);
          if (content) {
            const templateString = template || DEFAULT_DATAVIEW_TEMPLATE_STRING;
            const extractResult = extractFieldsFromRenderedItems(
              templateString,
              content,
            );
            if (!isErr(extractResult)) {
              dataview.data = extractResult.data;
            }
          }
          (currentParent.blockContent as Fieldset[]).push(dataview);
        }
        break;
      }
    }
  }

  return ok(document);
};

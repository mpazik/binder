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
  NodeSchema,
} from "@binder/db";
import type {
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  RootContent,
  Text,
} from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import { parseStringQuery, stringifyQuery } from "../utils/query.ts";
import { type BlockAST, parseMarkdown } from "./markdown.ts";
import {
  renderTemplate,
  extractFields,
  parseTemplate,
  type TemplateAST,
} from "./template.ts";

export const DEFAULT_DATAVIEW_VIEW_STRING =
  "title: {title}\n  description: {description}";

export const fetchDocumentNodes = async (
  kg: KnowledgeGraph,
  documentRef: NodeRef,
): ResultAsync<FieldsetNested> => {
  const documentResult = await kg.fetchEntity(documentRef);
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
      const searchResult = await kg.search(node.query as any);
      const data = isErr(searchResult) ? [] : searchResult.data.items;
      return { ...node, data };
    }

    const blockContent = node.blockContent as string[] | undefined;
    if (!blockContent || blockContent.length === 0) {
      return node;
    }

    const nestedBlockContent = await Promise.all(
      blockContent.map(async (uid) => {
        const childResult = await kg.fetchEntity(uid as NodeRef);
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

export const renderViewForItems = (
  schema: NodeSchema,
  template: TemplateAST,
  items: FieldsetNested[],
): Result<string> => {
  const renderedItems: string[] = [];

  for (const item of items) {
    const renderResult = renderTemplate(schema, template, item);
    if (isErr(renderResult)) return renderResult;
    const rendered = renderResult.data.trim();
    renderedItems.push(`- ${rendered}`);
  }

  return ok(renderedItems.join("\n"));
};
export const buildAstDoc = async (
  kg: KnowledgeGraph,
  documentRef: NodeRef,
): ResultAsync<BlockAST> => {
  const schemaResult = await kg.getNodeSchema();
  if (isErr(schemaResult)) return schemaResult;
  const schema = schemaResult.data;

  const documentResult = await fetchDocumentNodes(kg, documentRef);
  if (isErr(documentResult)) return documentResult;

  const document = documentResult.data;

  const renderNodeFlat = async (
    node: FieldsetNested,
    depth: number,
  ): Promise<RootContent[]> => {
    const nodeType = node.type as string;

    switch (nodeType) {
      case "Document": {
        const children: RootContent[] = [];
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
            depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
            children: [{ type: "text", value: node.title as string }],
          } as Heading,
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
            children: childrenArrays.flat() as ListItem[],
          } as List,
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
        const searchResult = await kg.search(node.query as any);

        const attributes: Record<string, string> = {
          query: stringifyQuery(node.query as any),
        };
        if (node.template) {
          attributes.template = node.template as string;
        }

        if (isErr(searchResult)) {
          return [
            {
              type: "containerDirective",
              name: "dataview",
              attributes: { ...attributes, error: "true" },
              children: [],
            },
          ];
        }

        const templateString = node.template
          ? (node.template as string)
          : DEFAULT_DATAVIEW_VIEW_STRING;
        const view = parseTemplate(templateString);
        const renderResult = renderViewForItems(schema, view, data);

        if (isErr(renderResult)) {
          const yamlContent = YAML.stringify(
            data.map((it) => pick(it, ["title", "description"])),
          );
          return [
            {
              type: "containerDirective",
              name: "dataview",
              attributes,
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: yamlContent }],
                },
              ],
            },
          ];
        }

        const content = renderResult.data || "";
        let children: RootContent[] = [];
        if (content) {
          const lines = content
            .split("\n")
            .filter((line: string) => line.trim());
          children = [
            {
              type: "list",
              ordered: false,
              start: null,
              spread: false,
              children: lines.map((line: string) => {
                const text = line.startsWith("- ") ? line.slice(2) : line;
                return {
                  type: "listItem",
                  spread: false,
                  checked: null,
                  children: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", value: text }],
                    } as Paragraph,
                  ],
                } as ListItem;
              }),
            } as List,
          ];
        }

        return [
          {
            type: "containerDirective",
            name: "dataview",
            attributes,
            children: children as ContainerDirective["children"],
          } as ContainerDirective,
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
  } as BlockAST);
};

const extractTextValue = (node: Nodes): string => {
  if (!("children" in node) || node.children.length === 0) return "";
  const firstChild = node.children[0] as Text;
  return firstChild.value || "";
};

const extractDirectiveContent = (node: ContainerDirective): string => {
  if (!node.children || node.children.length === 0) return "";

  const extractText = (n: Nodes): string[] => {
    if (n.type === "text") return [n.value || ""];
    if (n.type === "listItem" && "children" in n) {
      const text = n.children
        .flatMap((child) => extractText(child as Nodes))
        .join("");
      return [`- ${text}`];
    }
    if ("children" in n) {
      return n.children.flatMap((child) => extractText(child as Nodes));
    }
    return [];
  };

  return node.children
    .flatMap((child) => extractText(child as Nodes))
    .join("\n")
    .trim();
};

export const deconstructAstDocument = (
  schema: NodeSchema,
  ast: BlockAST,
): Result<Fieldset> => {
  const document: Fieldset = { type: "Document", blockContent: [] };
  let currentSection: Fieldset | null = null;

  for (const node of ast.children as Nodes[]) {
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
          blockContent: (node.children || []).map((listItemNode) => {
            const firstChild =
              "children" in listItemNode && listItemNode.children.length > 0
                ? (listItemNode.children[0] as Nodes)
                : ({ type: "text", value: "" } as Text);
            return {
              type: "ListItem",
              textContent: extractTextValue(firstChild),
            };
          }),
        };
        (currentParent.blockContent as Fieldset[]).push(list);
        break;
      }
      case "containerDirective": {
        const directive = node as ContainerDirective;
        if (directive.name === "dataview") {
          const queryString = directive.attributes?.query;
          if (queryString) {
            const queryResult = parseStringQuery(schema, queryString);
            if (isErr(queryResult)) {
              return err(
                createError(
                  "invalid-query",
                  `Failed to parse query: ${queryResult.error.message}`,
                  queryResult.error,
                ),
              );
            }
            const dataview: Fieldset = {
              type: "Dataview",
              query: queryResult.data,
            };
            const template = directive.attributes?.template;
            if (template) {
              dataview.template = template;
            }
            const content = extractDirectiveContent(directive);
            if (content) {
              const viewString = template || DEFAULT_DATAVIEW_VIEW_STRING;
              const view = parseTemplate(viewString);
              const contentLines = content.split("\n");
              const extractedItems: Fieldset[] = [];
              for (const line of contentLines) {
                if (!line.trim()) continue;
                const lineText = line.startsWith("- ") ? line.slice(2) : line;
                const lineAst = parseMarkdown(`${lineText}\n`);
                const extractResult = extractFields(schema, view, lineAst);
                if (!isErr(extractResult)) {
                  extractedItems.push(extractResult.data as Fieldset);
                }
              }
              if (extractedItems.length > 0) {
                dataview.data = extractedItems;
              }
            }
            (currentParent.blockContent as Fieldset[]).push(dataview);
          }
        }
        break;
      }
    }
  }

  return ok(document);
};

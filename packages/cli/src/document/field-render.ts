import {
  type FieldDef,
  type FieldValue,
  getDelimiterString,
  getMultiValueDelimiter,
  isMultilineFormat,
  stringifyFieldValue,
} from "@binder/db";
import type {
  Nodes,
  Paragraph,
  PhrasingContent,
  RootContent,
  Text,
  ThematicBreak,
} from "mdast";
import { parseAst } from "./markdown.ts";

const parseRichtextInline = (text: string): PhrasingContent[] => {
  const ast = parseAst(text);
  const firstChild = ast.children[0];
  if (firstChild?.type === "paragraph" && "children" in firstChild) {
    return firstChild.children;
  }
  return [{ type: "text", value: text }];
};

const parseRichtextBlock = (text: string): RootContent[] =>
  parseAst(text).children;

const parsePlaintextBlock = (text: string): Paragraph[] =>
  text.split(/\n\n+/).map((para) => ({
    type: "paragraph",
    children: [{ type: "text", value: para }],
  }));

const textNode = (value: string): Text => ({ type: "text", value });
const thematicBreak = (): ThematicBreak => ({ type: "thematicBreak" });

const renderSingleValue = (value: string, fieldDef: FieldDef): Nodes[] => {
  if (fieldDef.dataType === "richtext") {
    if (isMultilineFormat(fieldDef)) return parseRichtextBlock(value);
    return parseRichtextInline(value);
  }
  if (fieldDef.dataType === "plaintext" && isMultilineFormat(fieldDef)) {
    return parsePlaintextBlock(value);
  }
  return [textNode(value)];
};

const joinNodesWithDelimiter = (
  nodeGroups: Nodes[][],
  fieldDef: FieldDef,
): Nodes[] => {
  if (nodeGroups.length === 0) return [];
  if (nodeGroups.length === 1) return nodeGroups[0]!;

  const delimiter = getMultiValueDelimiter(fieldDef);
  if (delimiter === "hrule") {
    return nodeGroups.flatMap((group, i) =>
      i < nodeGroups.length - 1 ? [...group, thematicBreak()] : group,
    );
  }

  // Block-level content is naturally separated by the serializer
  if (isMultilineFormat(fieldDef)) return nodeGroups.flat();

  const delimiterStr = getDelimiterString(delimiter);
  const result: Nodes[] = [];
  for (const [i, group] of nodeGroups.entries()) {
    result.push(...group);
    if (i < nodeGroups.length - 1) {
      const lastNode = result[result.length - 1];
      if (lastNode?.type === "text") {
        lastNode.value += delimiterStr;
      } else {
        result.push(textNode(delimiterStr));
      }
    }
  }
  return result;
};

export const renderFieldValue = (
  value: FieldValue | undefined,
  fieldDef: FieldDef,
): Nodes[] => {
  if (value === null || value === undefined) return [textNode("")];

  if (Array.isArray(value)) {
    if (value.length === 0) return [textNode("")];
    const nodeGroups = value.map((item) =>
      renderSingleValue(String(item), fieldDef),
    );
    return joinNodesWithDelimiter(nodeGroups, fieldDef);
  }

  return renderSingleValue(stringifyFieldValue(value, fieldDef), fieldDef);
};

export const isBlockLevelField = (fieldDef: FieldDef | undefined): boolean =>
  isMultilineFormat(fieldDef ?? ({ dataType: "plaintext" } as FieldDef));

import type { FieldKey, FieldsetNested, FieldValue } from "@binder/db";
import { isErr, ok, type Result } from "@binder/utils";
import { Document, isMap } from "yaml";
import { applyInlineFormatting, parseYamlEntity } from "./yaml.ts";
import type { BlockAST } from "./markdown.ts";

export const renderFrontmatterString = (
  entity: FieldsetNested,
  preambleKeys: FieldKey[],
): string | undefined => {
  const data: Record<string, FieldValue> = {};
  let hasValue = false;

  for (const key of preambleKeys) {
    const value = entity[key];
    if (value === null || value === undefined) continue;
    data[key] = value;
    hasValue = true;
  }

  if (!hasValue) return undefined;

  const doc = new Document(data);
  const root = doc.contents;
  if (isMap(root)) {
    applyInlineFormatting(root);
  }
  return doc.toString({ indent: 2, lineWidth: 0 }).trimEnd();
};

export const prependFrontmatter = (
  markdown: string,
  frontmatter: string,
): string => `---\n${frontmatter}\n---\n\n${markdown}`;

export const extractFrontmatterFromAst = (
  ast: BlockAST,
): Result<{ frontmatterFields: FieldsetNested; bodyAst: BlockAST }> => {
  const yamlNode = ast.children.find((child) => child.type === "yaml");
  if (!yamlNode || !("value" in yamlNode) || typeof yamlNode.value !== "string")
    return ok({ frontmatterFields: {}, bodyAst: ast });

  const parseResult = parseYamlEntity(yamlNode.value);
  if (isErr(parseResult)) return parseResult;

  const bodyAst = {
    ...ast,
    children: ast.children.filter((child) => child.type !== "yaml"),
  } as BlockAST;

  return ok({ frontmatterFields: parseResult.data, bodyAst });
};

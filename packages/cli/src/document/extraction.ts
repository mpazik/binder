import {
  type EntitySchema,
  type FieldsetNested,
  type FieldValue,
  type Includes,
  isFieldsetNested,
  type QueryParams,
} from "@binder/db";
import { createError, err, isErr, ok, type Result } from "@binder/utils";
import { findTemplate, type NavigationItem } from "./navigation.ts";
import { parseMarkdown } from "./markdown.ts";
import { extractFields } from "./template.ts";
import { parseYamlEntity, parseYamlList } from "./yaml.ts";
import { getDocumentFileType } from "./document.ts";
import type { TemplateKey, Templates } from "./template-entity.ts";
import { extractFrontmatterFromAst } from "./frontmatter.ts";
import { createFieldAccumulator } from "./field-accumulator.ts";

export type ExtractedProjection = {
  items: FieldsetNested[];
  query: QueryParams;
};

export type ExtractedFileData =
  | { kind: "single"; entity: FieldsetNested }
  | { kind: "list"; entities: FieldsetNested[]; query: QueryParams }
  | {
      kind: "document";
      entity: FieldsetNested;
      projections: ExtractedProjection[];
      includes: Includes | undefined;
    };

const dedupeByUid = (entities: FieldsetNested[]): FieldsetNested[] => {
  const seenUids = new Set<string>();
  return entities.map((node) => {
    const uid = node.uid;
    if (typeof uid !== "string") return node;
    if (seenUids.has(uid)) {
      const { uid: _, ...rest } = node;
      return rest;
    }
    seenUids.add(uid);
    return node;
  });
};

const isQueryParams = (value: unknown): value is QueryParams =>
  typeof value === "object" && value !== null && "filters" in value;

const extractProjections = (entity: FieldsetNested): ExtractedProjection[] => {
  const projections: ExtractedProjection[] = [];

  const traverse = (node: FieldsetNested) => {
    if (node.type === "Dataview" && isQueryParams(node.query)) {
      const data = node.data;
      if (Array.isArray(data)) {
        const items = data.filter(isFieldsetNested);
        projections.push({ items, query: node.query });
      }
    }

    const blockContent = node.blockContent;
    if (Array.isArray(blockContent)) {
      for (const child of blockContent) {
        if (isFieldsetNested(child)) {
          traverse(child);
        }
      }
    }
  };

  traverse(entity);
  return projections;
};

const extractFromYamlSingle = (content: string): Result<ExtractedFileData> => {
  const parseResult = parseYamlEntity(content);
  if (isErr(parseResult)) return parseResult;

  return ok({ kind: "single", entity: parseResult.data });
};

const extractFromYamlList = (
  navItem: NavigationItem,
  content: string,
): Result<ExtractedFileData> => {
  const parseResult = parseYamlList(content);
  if (isErr(parseResult)) return parseResult;

  if (!navItem.query) {
    return err(
      createError(
        "missing_query",
        "Navigation item with YAML list must have query",
      ),
    );
  }

  return ok({
    kind: "list",
    entities: parseResult.data,
    query: navItem.query,
  });
};

const extractFromMarkdown = (
  schema: EntitySchema,
  navItem: NavigationItem,
  markdown: string,
  templates: Templates,
  base: FieldsetNested,
): Result<ExtractedFileData> => {
  const template = findTemplate(templates, navItem.template);
  const markdownAst = parseMarkdown(markdown);

  const hasPreamble =
    template.preamble !== undefined && template.preamble.length > 0;
  const fmResult = hasPreamble
    ? extractFrontmatterFromAst(markdownAst)
    : ok({ frontmatterFields: {}, bodyAst: markdownAst });
  if (isErr(fmResult)) return fmResult;

  const { frontmatterFields, bodyAst } = fmResult.data;

  const fileFieldsResult = extractFields(
    schema,
    templates,
    template.key as TemplateKey,
    bodyAst,
    base,
  );
  if (isErr(fileFieldsResult)) return fileFieldsResult;

  const accumulator = createFieldAccumulator(base);

  for (const [key, value] of Object.entries(fileFieldsResult.data)) {
    accumulator.set([key], value as FieldValue, { origin: "body" });
  }
  for (const [key, value] of Object.entries(frontmatterFields)) {
    accumulator.set([key], value as FieldValue, { origin: "frontmatter" });
  }

  const mergeResult = accumulator.result();
  if (isErr(mergeResult)) return mergeResult;

  const entity = mergeResult.data;
  const projections = extractProjections(entity);

  return ok({
    kind: "document",
    entity,
    projections,
    includes: template.templateIncludes,
  });
};

export const extractRaw = (
  schema: EntitySchema,
  navItem: NavigationItem,
  content: string,
  filePath: string,
  templates: Templates,
  base: FieldsetNested,
): Result<ExtractedFileData> => {
  const fileType = getDocumentFileType(filePath);

  if (fileType === "yaml") {
    if (navItem.includes) {
      return extractFromYamlSingle(content);
    }
    if (navItem.query) {
      return extractFromYamlList(navItem, content);
    }
    return err(
      createError(
        "invalid_yaml_config",
        "YAML navigation item must have includes or query",
      ),
    );
  }

  if (fileType === "markdown") {
    return extractFromMarkdown(schema, navItem, content, templates, base);
  }

  return err(
    createError("unsupported_file_type", "Unsupported file type", {
      path: filePath,
    }),
  );
};

export const extract = (
  schema: EntitySchema,
  navItem: NavigationItem,
  content: string,
  filePath: string,
  templates: Templates,
  base: FieldsetNested,
): Result<ExtractedFileData> => {
  const rawResult = extractRaw(
    schema,
    navItem,
    content,
    filePath,
    templates,
    base,
  );
  if (isErr(rawResult)) return rawResult;

  const data = rawResult.data;

  if (data.kind === "single") {
    return ok(data);
  }

  if (data.kind === "list") {
    return ok({
      ...data,
      entities: dedupeByUid(data.entities),
    });
  }

  return ok({
    ...data,
    projections: data.projections.map((p) => ({
      ...p,
      items: dedupeByUid(p.items),
    })),
  });
};

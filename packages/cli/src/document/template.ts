import Handlebars from "handlebars";
import {
  createError,
  err,
  errorToObject,
  isErr,
  ok,
  type Result,
  throwIfError,
  tryCatch,
} from "@binder/utils";
import type { Fieldset } from "@binder/db";

export type CompiledTemplate = ReturnType<typeof Handlebars.compile>;

export const compileTemplate = (
  templateString: string,
): Result<CompiledTemplate> => {
  return tryCatch(() => Handlebars.compile(templateString), errorToObject);
};

export type ParsedTemplate = ReturnType<typeof Handlebars.parse>;

export const parseTemplate = (
  templateString: string,
): Result<ParsedTemplate> => {
  return tryCatch(() => Handlebars.parse(templateString), errorToObject);
};

export const DEFAULT_DATAVIEW_TEMPLATE_STRING =
  "title: {{title}}\n  description: {{description}}";

export const DEFAULT_DATAVIEW_TEMPLATE = throwIfError(
  compileTemplate(DEFAULT_DATAVIEW_TEMPLATE_STRING),
);

export const DEFAULT_DYNAMIC_TEMPLATE_STRING = `# {{title}}

**Type:** {{type}}
**UID:** {{uid}}
{{#if key}}**Key:** {{key}}{{/if}}

## Description

{{description}}`;

export const DEFAULT_DYNAMIC_TEMPLATE = throwIfError(
  compileTemplate(DEFAULT_DYNAMIC_TEMPLATE_STRING),
);
export const DEFAULT_DYNAMIC_TEMPLATE_PARSED = throwIfError(
  parseTemplate(DEFAULT_DYNAMIC_TEMPLATE_STRING),
);

export const renderTemplate = (
  template: CompiledTemplate,
  data: Fieldset,
): Result<string> => {
  return tryCatch(() => template(data), errorToObject);
};

export const renderTemplateForItems = (
  template: CompiledTemplate,
  items: Fieldset[],
): Result<string> => {
  const renderedItems: string[] = [];

  for (const item of items) {
    const renderResult = tryCatch(() => template(item), errorToObject);
    if (isErr(renderResult)) return renderResult;
    renderedItems.push(`- ${renderResult.data}`);
  }

  return ok(renderedItems.join("\n"));
};

type TemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "variable"; path: string[] }
  | { kind: "optional"; segments: TemplateSegment[] };

const SUPPORTED_BLOCK_HELPERS = new Set(["if"]);

type Anchor = { kind: "literal"; value: string } | { kind: "flexWhitespace" };

const handlebarsStatementToSegments = (
  statement: any,
): Result<TemplateSegment[]> => {
  switch (statement.type) {
    case "ContentStatement": {
      const value = statement.value ?? "";
      return value.length === 0
        ? ok([])
        : ok([{ kind: "text", value } satisfies TemplateSegment]);
    }
    case "MustacheStatement": {
      const path: any = statement.path;
      if (!path || path.type !== "PathExpression") {
        return err(
          createError(
            "template-extraction-unsupported",
            "Unsupported mustache path",
            {
              statement,
            },
          ),
        );
      }
      const pathParts =
        Array.isArray(path.parts) && path.parts.length > 0
          ? path.parts
          : [path.original].filter(Boolean);
      return ok([
        {
          kind: "variable",
          path: pathParts,
        } satisfies TemplateSegment,
      ]);
    }
    case "BlockStatement": {
      const path: any = statement.path;
      if (!path || path.type !== "PathExpression") {
        return err(
          createError(
            "template-extraction-unsupported",
            "Unsupported block path",
            {
              statement,
            },
          ),
        );
      }
      const helperName = path.original;
      if (!SUPPORTED_BLOCK_HELPERS.has(helperName)) {
        return err(
          createError(
            "template-extraction-unsupported",
            "Unsupported block helper",
            {
              helper: helperName,
            },
          ),
        );
      }
      if (statement.inverse) {
        return err(
          createError(
            "template-extraction-unsupported",
            "Inverse blocks are not supported",
            {
              helper: helperName,
            },
          ),
        );
      }
      const programBody = statement.program?.body ?? [];
      const nestedSegmentsResult = handlebarsStatementsToSegments(programBody);
      if (isErr(nestedSegmentsResult)) return nestedSegmentsResult;
      const nestedSegments = nestedSegmentsResult.data;
      if (nestedSegments.length === 0) return ok([]);
      return ok([
        {
          kind: "optional",
          segments: nestedSegments,
        } satisfies TemplateSegment,
      ]);
    }
    default:
      return err(
        createError(
          "template-extraction-unsupported",
          "Unsupported template node",
          {
            type: statement.type,
          },
        ),
      );
  }
};

const handlebarsStatementsToSegments = (
  statements: any[],
): Result<TemplateSegment[]> => {
  const segments: TemplateSegment[] = [];
  for (const statement of statements) {
    const result = handlebarsStatementToSegments(statement);
    if (isErr(result)) return result;
    segments.push(...result.data);
  }
  return ok(segments);
};

const collectFirstAnchors = (segments: TemplateSegment[]): Anchor[] => {
  const literalSet = new Set<string>();
  let hasFlexWhitespace = false;
  const anchors: Anchor[] = [];

  const addLiteral = (literal: string) => {
    if (!literalSet.has(literal)) {
      literalSet.add(literal);
      anchors.push({ kind: "literal", value: literal });
    }
  };

  const addFlexWhitespace = () => {
    if (!hasFlexWhitespace) {
      anchors.push({ kind: "flexWhitespace" });
      hasFlexWhitespace = true;
    }
  };

  const visit = (remaining: TemplateSegment[]) => {
    if (remaining.length === 0) return;
    const [first, ...rest] = remaining;
    if (first.kind === "text") {
      if (first.value.length > 0) {
        addLiteral(first.value);
        if (first.value.trim().length === 0 && first.value.includes("\n")) {
          addFlexWhitespace();
          visit(rest);
        }
      } else {
        visit(rest);
      }
      return;
    }
    if (first.kind === "variable") {
      visit(rest);
      return;
    }
    if (first.kind === "optional") {
      visit([...first.segments, ...rest]);
      visit(rest);
    }
  };

  visit(segments);
  return anchors;
};

const cloneAssignments = (
  assignments: Map<string, string | null>,
): Map<string, string | null> => {
  return new Map(assignments);
};

type MatchSuccess = {
  pos: number;
  assignments: Map<string, string | null>;
};

const applyAssignment = (
  assignments: Map<string, string | null>,
  path: string[],
  value: string | null,
): boolean => {
  const key = path.join(".");
  if (!assignments.has(key)) {
    assignments.set(key, value);
    return true;
  }
  return assignments.get(key) === value;
};

const matchSegments = (
  segments: TemplateSegment[],
  input: string,
  pos: number,
  assignments: Map<string, string | null>,
): MatchSuccess | null => {
  if (segments.length === 0) {
    return pos === input.length ? { pos, assignments } : null;
  }

  const [segment, ...rest] = segments;

  if (segment.kind === "text") {
    if (segment.value === "\n") {
      if (input[pos] !== "\n" && input[pos] !== "\r") return null;
      const nextPos =
        input[pos] === "\r" && input[pos + 1] === "\n" ? pos + 2 : pos + 1;
      return matchSegments(rest, input, nextPos, assignments);
    }
    if (segment.value.trim().length === 0 && segment.value.includes("\n")) {
      let end = pos;
      while (end < input.length && /\s/.test(input[end] ?? "")) end++;
      if (end === pos) return null;
      return matchSegments(rest, input, end, assignments);
    }
    if (!input.startsWith(segment.value, pos)) {
      return null;
    }
    return matchSegments(rest, input, pos + segment.value.length, assignments);
  }

  if (segment.kind === "optional") {
    const includeAssignments = cloneAssignments(assignments);
    const withOptional = matchSegments(
      [...segment.segments, ...rest],
      input,
      pos,
      includeAssignments,
    );
    if (withOptional) return withOptional;
    const withoutOptional = matchSegments(rest, input, pos, assignments);
    return withoutOptional;
  }

  const isAtLineStart =
    pos === 0 || input[pos - 1] === "\n" || input[pos - 1] === "\r";

  const anchors = collectFirstAnchors(rest);
  const candidateEnds = new Set<number>();

  if (rest.length === 0) {
    candidateEnds.add(input.length);
  } else {
    for (const anchor of anchors) {
      if (anchor.kind === "literal") {
        if (anchor.value.length === 0) continue;
        let index = pos;
        while (index <= input.length) {
          index = input.indexOf(anchor.value, index);
          if (index === -1) break;
          candidateEnds.add(index);
          index += 1;
        }
      } else if (anchor.kind === "flexWhitespace") {
        let index = pos;
        while (
          index < input.length &&
          input[index] !== "\n" &&
          input[index] !== "\r"
        ) {
          index += 1;
        }
        if (index < input.length) candidateEnds.add(index);
      }
    }
  }

  const nextSegmentIsLiteralBeforeNewline =
    rest.length > 0 &&
    rest[0].kind === "text" &&
    rest[0].value !== "\n" &&
    !rest[0].value.includes("\n");

  if (!isAtLineStart && !nextSegmentIsLiteralBeforeNewline) {
    let newlineIndex = pos;
    while (
      newlineIndex < input.length &&
      input[newlineIndex] !== "\n" &&
      input[newlineIndex] !== "\r"
    ) {
      newlineIndex++;
    }

    const value = input.slice(pos, newlineIndex);
    const trimmed = value.trim();
    const assignmentValue = trimmed.length === 0 ? null : value;

    const clonedAssignments = cloneAssignments(assignments);
    if (applyAssignment(clonedAssignments, segment.path, assignmentValue)) {
      const result = matchSegments(
        rest,
        input,
        newlineIndex,
        clonedAssignments,
      );
      if (result) return result;
    }

    return null;
  }

  candidateEnds.add(pos);
  candidateEnds.add(input.length);

  const sortedCandidates = [...candidateEnds].sort((a, b) => a - b);
  for (const end of sortedCandidates) {
    if (end < pos || end > input.length) continue;
    const value = input.slice(pos, end);
    const clonedAssignments = cloneAssignments(assignments);
    if (!applyAssignment(clonedAssignments, segment.path, value)) continue;
    const result = matchSegments(rest, input, end, clonedAssignments);
    if (result) return result;
  }

  const hasLiteralAnchors = anchors.some((anchor) => anchor.kind === "literal");
  if (!hasLiteralAnchors) {
    for (let end = pos; end <= input.length; end++) {
      const value = input.slice(pos, end);
      const clonedAssignments = cloneAssignments(assignments);
      if (!applyAssignment(clonedAssignments, segment.path, value)) continue;
      const result = matchSegments(rest, input, end, clonedAssignments);
      if (result) return result;
    }
  }

  return null;
};

const assignmentsToFieldset = (
  assignments: Map<string, string | null>,
): Result<Fieldset> => {
  const result: Fieldset = {};

  for (const [path, value] of assignments.entries()) {
    if (path.length === 0) continue;
    const parts = path.split(".");
    let current: Fieldset | string | null = result;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        if (part in current) {
          const existing = current[part];
          if (existing !== value) {
            return err(
              createError(
                "template-extraction-mismatch",
                "Conflicting values for template variable",
                {
                  path,
                  existing,
                  value,
                },
              ),
            );
          }
        } else {
          current[part] = value;
        }
      } else {
        if (!(part in current)) {
          current[part] = {} as Fieldset;
        }
        const next = current[part];
        if (typeof next !== "object" || next === null || Array.isArray(next)) {
          return err(
            createError(
              "template-extraction-mismatch",
              "Path collision while assigning template value",
              {
                path,
              },
            ),
          );
        }
        current = next as Fieldset;
      }
    }
  }

  return ok(result);
};

export const extractFieldsFromRendered = (
  templateString: string,
  markdown: string,
): Result<Fieldset> => {
  const templateAstResult = parseTemplate(templateString);
  if (isErr(templateAstResult)) return templateAstResult;

  const segmentsResult = handlebarsStatementsToSegments(
    templateAstResult.data.body ?? [],
  );
  if (isErr(segmentsResult)) return segmentsResult;
  const segments = segmentsResult.data;

  const match = matchSegments(segments, markdown, 0, new Map());
  if (!match) {
    return err(
      createError(
        "template-extraction-mismatch",
        "Rendered markdown does not match template structure",
        {
          template: templateString,
          markdown,
        },
      ),
    );
  }

  return assignmentsToFieldset(match.assignments);
};

const findStartAnchor = (segments: TemplateSegment[]): string | null => {
  for (const segment of segments) {
    if (segment.kind === "text") {
      const trimmed = segment.value.trimStart();
      if (trimmed.length > 0) {
        const firstLine = trimmed.split("\n")[0];
        if (firstLine.length > 0) return firstLine;
      }
    }
    if (segment.kind === "variable") {
      return null;
    }
    if (segment.kind === "optional") {
      continue;
    }
  }
  return null;
};

const splitByAnchor = (content: string, anchor: string): string[] => {
  if (anchor.length === 0) return [content];

  const items: string[] = [];
  let pos = 0;

  while (pos < content.length) {
    const nextPos = content.indexOf(anchor, pos + 1);
    if (nextPos === -1) {
      items.push(content.slice(pos).trim());
      break;
    }
    items.push(content.slice(pos, nextPos).trim());
    pos = nextPos;
  }

  return items.filter((item) => item.length > 0);
};

export const extractFieldsFromRenderedItems = (
  templateString: string,
  renderedContent: string,
): Result<Fieldset[]> => {
  if (renderedContent.trim().length === 0) {
    return ok([]);
  }

  const templateAstResult = parseTemplate(templateString);
  if (isErr(templateAstResult)) return templateAstResult;

  const segmentsResult = handlebarsStatementsToSegments(
    templateAstResult.data.body ?? [],
  );
  if (isErr(segmentsResult)) return segmentsResult;

  const startAnchor = findStartAnchor(segmentsResult.data);

  let items: string[];
  if (!startAnchor) {
    items = renderedContent
      .split("\n")
      .filter((line) => line.trim().startsWith("- "));
  } else {
    const anchorWithPrefix = `- ${startAnchor}`;
    items = splitByAnchor(renderedContent, anchorWithPrefix);
  }

  const results: Fieldset[] = [];
  for (const item of items) {
    const strippedItem = item.startsWith("- ") ? item.slice(2) : item;
    const extractResult = extractFieldsFromRendered(
      templateString,
      strippedItem,
    );
    if (isErr(extractResult)) return extractResult;
    results.push(extractResult.data);
  }

  return ok(results);
};

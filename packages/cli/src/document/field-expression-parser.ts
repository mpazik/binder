import type { FieldPath } from "@binder/db";
import { type Result, ok, fail } from "@binder/utils";

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue | PropValue[]>;

export interface FieldExpression<T extends Props = Props> {
  path: FieldPath;
  props?: T;
}

const parseValue = (raw: string): PropValue => {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  return trimmed;
};

const parsePropertyArgs = (argsStr: string): PropValue[] => {
  if (!argsStr.trim()) return [];

  const args: PropValue[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i]!;

    if (inQuote) {
      current += char;
      if (char === inQuote) inQuote = null;
    } else if (char === '"' || char === "'") {
      inQuote = char;
      current += char;
    } else if (char === ",") {
      if (current.trim()) args.push(parseValue(current));
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) args.push(parseValue(current));
  return args;
};

const parseProperties = (
  propsStr: string,
): Result<{ name: string; args: PropValue[] }> => {
  const colonIndex = propsStr.indexOf(":");
  if (colonIndex === -1) {
    const name = propsStr.trim();
    if (!name)
      return fail("empty-property-name", "Property name cannot be empty");
    return ok({ name, args: [] });
  }

  const name = propsStr.slice(0, colonIndex).trim();
  if (!name)
    return fail("empty-property-name", "Property name cannot be empty");

  const argsStr = propsStr.slice(colonIndex + 1);
  const args = parsePropertyArgs(argsStr);
  return ok({ name, args });
};

export const parseFieldExpression = <T extends Props = Props>(
  raw: string,
): Result<FieldExpression<T>> => {
  const trimmed = raw.trim();
  if (!trimmed) return fail("empty-expression", "Expression cannot be empty");

  const pipeIndex = trimmed.indexOf("|");

  if (pipeIndex === -1) {
    const path = trimmed.split(".") as unknown as FieldPath;
    if (path.some((p) => !p))
      return fail("invalid-path", "Path contains empty segments");
    return ok({ path } as FieldExpression<T>);
  }

  const pathPart = trimmed.slice(0, pipeIndex).trim();
  if (!pathPart) return fail("empty-path", "Path cannot be empty");

  const path = pathPart.split(".") as unknown as FieldPath;
  if (path.some((p) => !p))
    return fail("invalid-path", "Path contains empty segments");

  const propsPart = trimmed.slice(pipeIndex + 1);
  const propSegments = propsPart.split("|");
  const props: Props = {};

  for (const segment of propSegments) {
    const result = parseProperties(segment);
    if (result.error) return result as Result<FieldExpression<T>>;

    const { name, args } = result.data;
    if (args.length === 0) {
      props[name] = true;
    } else if (args.length === 1) {
      props[name] = args[0]!;
    } else {
      props[name] = args;
    }
  }

  return ok({ path, props: props as T });
};

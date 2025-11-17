import * as YAML from "yaml";
import { isErr, ok, tryCatch, type Result } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";

export const renderYamlEntity = (data: FieldsetNested): string =>
  YAML.stringify(data, { indent: 2, lineWidth: 0 });

export const renderYamlList = (data: FieldsetNested[]): string =>
  YAML.stringify({ items: data }, { indent: 2, lineWidth: 0 });

export const parseYamlEntity = (content: string): Result<FieldsetNested> => {
  const parseResult = tryCatch(() => YAML.parse(content) as FieldsetNested);
  if (isErr(parseResult)) return parseResult;
  return ok(parseResult.data);
};

export const parseYamlList = (content: string): Result<FieldsetNested[]> => {
  const parseResult = tryCatch(
    () => YAML.parse(content) as { items: FieldsetNested[] },
  );
  if (isErr(parseResult)) return parseResult;
  return ok(parseResult.data.items);
};

import Handlebars from "handlebars";
import {
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

export const DEFAULT_DATAVIEW_TEMPLATE = throwIfError(
  compileTemplate("- title: {{title}}\n  description: {{description}}"),
);

export const DEFAULT_DYNAMIC_TEMPLATE = throwIfError(
  compileTemplate(`# {{title}}

**Type:** {{type}}
**UID:** {{uid}}
{{#if key}}**Key:** {{key}}{{/if}}

## Description

{{description}}`),
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
    renderedItems.push(renderResult.data);
  }

  return ok(renderedItems.join("\n"));
};

import { type Brand } from "@binder/utils";

export type TemplateKey = Brand<string, "TemplateKey">;
export const TEMPLATE_TEMPLATE_KEY = "__template__" as TemplateKey;
export const PHRASE_TEMPLATE_KEY = "__inline__" as TemplateKey;
export const LINE_TEMPLATE_KEY = "__line__" as TemplateKey;
export const BLOCK_TEMPLATE_KEY = "__block__" as TemplateKey;
export const SECTION_TEMPLATE_KEY = "__section__" as TemplateKey;
export const DOCUMENT_TEMPLATE_KEY = "__document__" as TemplateKey;

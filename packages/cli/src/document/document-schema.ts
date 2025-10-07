import { newIsoTimestamp } from "@binder/utils";
import type {
  ConfigKey,
  ConfigType,
  ConfigUid,
  TransactionInput,
} from "@binder/db";

export const fieldTitleUid = "a7Kx2mPqRtU" as ConfigUid;
export const fieldBlockContentUid = "b9Lm3nQrSvW" as ConfigUid;
export const fieldTextContentUid = "c1Np4oRsTwX" as ConfigUid;
export const fieldHeadingLevelUid = "d2Oq5pStUxY" as ConfigUid;
export const fieldCitationSourceUid = "e3Pr6qTuVyZ" as ConfigUid;
export const fieldCodeLanguageUid = "f4Qs7rVwWzA" as ConfigUid;
export const fieldQueryUid = "g5Rt8sWxXaB" as ConfigUid;
export const fieldTemplateUid = "h6Su9tYzYbC" as ConfigUid;

export const typeDocumentUid = "i7Tv0uZaZcD" as ConfigUid;
export const typeDocumentBlockUid = "j8Uw1vAbAdE" as ConfigUid;
export const typeSectionUid = "k9Vx2wBcBeF" as ConfigUid;
export const typeParagraphUid = "l0Wy3xCdCfG" as ConfigUid;
export const typeQuoteUid = "m1Xz4yDeDgH" as ConfigUid;
export const typeCodeUid = "n2Ya5zEfEhI" as ConfigUid;
export const typeDataviewUid = "o3Zb6aFgFiJ" as ConfigUid;

export const documentSchemaTransactionInput: TransactionInput = {
  author: "system",
  createdAt: newIsoTimestamp("2024-01-01"),
  nodes: [],
  configurations: [
    {
      uid: fieldTitleUid,
      type: "Field" as ConfigType,
      key: "title" as ConfigKey,
      dataType: "string",
      description: "A few word description of the node.",
    },
    {
      uid: fieldBlockContentUid,
      type: "Field" as ConfigType,
      key: "blockContent" as ConfigKey,
      dataType: "relation",
      multiple: true,
      range: "DocumentBlock",
      ordered: true,
      description: "Ordered list of child blocks.",
    },
    {
      uid: fieldTextContentUid,
      type: "Field" as ConfigType,
      key: "textContent" as ConfigKey,
      dataType: "text",
      description: "Text content.",
    },
    {
      uid: fieldHeadingLevelUid,
      type: "Field" as ConfigType,
      key: "headingLevel" as ConfigKey,
      dataType: "integer",
      min: 1,
      max: 6,
      description: "Heading level from 1 to 6.",
    },
    {
      uid: fieldCitationSourceUid,
      type: "Field" as ConfigType,
      key: "citationSource" as ConfigKey,
      dataType: "string",
      description: "Citation or source reference.",
    },
    {
      uid: fieldCodeLanguageUid,
      type: "Field" as ConfigType,
      key: "codeLanguage" as ConfigKey,
      dataType: "string",
      description: "Programming language identifier.",
    },
    {
      uid: fieldQueryUid,
      type: "Field" as ConfigType,
      key: "query" as ConfigKey,
      dataType: "query",
      description: "Query expression.",
    },
    {
      uid: fieldTemplateUid,
      type: "Field" as ConfigType,
      key: "template" as ConfigKey,
      dataType: "string",
      description: "Template string.",
    },
    {
      uid: typeDocumentUid,
      type: "Type" as ConfigType,
      key: "Document" as ConfigKey,
      description: "A top-level note made of ordered blocks.",
      fields: ["title", "blockContent"],
    },
    {
      uid: typeDocumentBlockUid,
      type: "Type" as ConfigType,
      key: "DocumentBlock" as ConfigKey,
      description: "Abstract base for all blocks. Not instantiable.",
      abstract: true,
    },
    {
      uid: typeSectionUid,
      type: "Type" as ConfigType,
      key: "Section" as ConfigKey,
      baseType: "DocumentBlock",
      description: "A titled container with nested blocks.",
      fields: ["title", "blockContent"],
    },
    {
      uid: typeParagraphUid,
      type: "Type" as ConfigType,
      key: "Paragraph" as ConfigKey,
      baseType: "DocumentBlock",
      description: "A text paragraph block.",
      fields: ["textContent"],
    },
    {
      uid: typeQuoteUid,
      type: "Type" as ConfigType,
      key: "Quote" as ConfigKey,
      baseType: "DocumentBlock",
      description: "A quoted text block.",
      fields: ["textContent", { citationSource: { optional: true } }],
    },
    {
      uid: typeCodeUid,
      type: "Type" as ConfigType,
      key: "Code" as ConfigKey,
      baseType: "DocumentBlock",
      description: "A code block.",
      fields: ["codeLanguage", "textContent"],
    },
    {
      uid: typeDataviewUid,
      type: "Type" as ConfigType,
      key: "Dataview" as ConfigKey,
      baseType: "DocumentBlock",
      description: "A query-driven view block.",
      fields: ["query", { template: { optional: true } }],
    },
  ],
};

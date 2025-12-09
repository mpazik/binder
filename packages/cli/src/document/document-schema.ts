import { newIsoTimestamp } from "@binder/utils";
import {
  changesetInputForNewEntity,
  type ConfigKey,
  type ConfigUid,
  titleFieldKey,
  fieldSystemType,
  newAppConfigId,
  type NodeFieldDef,
  type NodeType,
  type TransactionInput,
  type TypeDef,
  typeSystemType,
} from "@binder/db";

export const typeDocumentBlockUid = "j8Uw1vAbAdE" as ConfigUid;
export const typeDocumentBlockKey = "DocumentBlock" as NodeType;
export const fieldBlockContentUid = "b9Lm3nQrSvW" as ConfigUid;
export const fieldBlockContentKey = "blockContent" as ConfigKey;
const fieldBlockContent = {
  id: newAppConfigId(1),
  uid: fieldBlockContentUid,
  key: fieldBlockContentKey,
  type: fieldSystemType,
  name: "Block Content",
  description: "Ordered list of child blocks.",
  dataType: "relation",
  allowMultiple: true,
  range: [typeDocumentBlockKey],
} as const satisfies NodeFieldDef;

export const fieldTextContentUid = "c1Np4oRsTwX" as ConfigUid;
export const fieldTextContentKey = "textContent" as ConfigKey;
const fieldTextContent = {
  id: newAppConfigId(2),
  uid: fieldTextContentUid,
  key: fieldTextContentKey,
  type: fieldSystemType,
  name: "Text Content",
  description: "Text content.",
  dataType: "text",
} as const satisfies NodeFieldDef;

export const fieldHeadingLevelUid = "d2Oq5pStUxY" as ConfigUid;
export const fieldHeadingLevelKey = "headingLevel" as ConfigKey;
const fieldHeadingLevel = {
  id: newAppConfigId(3),
  uid: fieldHeadingLevelUid,
  key: fieldHeadingLevelKey,
  type: fieldSystemType,
  name: "Heading Level",
  description: "Heading level from 1 to 6.",
  dataType: "integer",
} as const satisfies NodeFieldDef;

export const fieldCitationSourceUid = "e3Pr6qTuVyZ" as ConfigUid;
export const fieldCitationSourceKey = "citationSource" as ConfigKey;
const fieldCitationSource = {
  id: newAppConfigId(4),
  uid: fieldCitationSourceUid,
  key: fieldCitationSourceKey,
  type: fieldSystemType,
  name: "Citation Source",
  description: "Citation or source reference.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const fieldCodeLanguageUid = "f4Qs7rVwWzA" as ConfigUid;
export const fieldCodeLanguageKey = "codeLanguage" as ConfigKey;
const fieldCodeLanguage = {
  id: newAppConfigId(5),
  uid: fieldCodeLanguageUid,
  key: fieldCodeLanguageKey,
  type: fieldSystemType,
  name: "Code Language",
  description: "Programming language identifier.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const fieldQueryUid = "g5Rt8sWxXaB" as ConfigUid;
export const fieldQueryKey = "query" as ConfigKey;
const fieldQuery = {
  id: newAppConfigId(6),
  uid: fieldQueryUid,
  key: fieldQueryKey,
  type: fieldSystemType,
  name: "Query",
  description: "Query expression.",
  dataType: "query",
} as const satisfies NodeFieldDef;

export const fieldTemplateUid = "h6Su9tYzYbC" as ConfigUid;
export const fieldTemplateKey = "template" as ConfigKey;
const fieldTemplate = {
  id: newAppConfigId(7),
  uid: fieldTemplateUid,
  key: fieldTemplateKey,
  type: fieldSystemType,
  name: "Template",
  description: "Template string.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const fieldPathUid = "r6Cd9eIjIlM" as ConfigUid;
export const fieldPathKey = "path" as ConfigKey;
const fieldPath = {
  id: newAppConfigId(8),
  uid: fieldPathUid,
  key: fieldPathKey,
  type: fieldSystemType,
  name: "Path",
  description: "File system path.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const typeDocumentUid = "i7Tv0uZaZcD" as ConfigUid;
export const typeDocumentKey = "Document" as NodeType;
const typeDocument = {
  id: newAppConfigId(9),
  uid: typeDocumentUid,
  key: typeDocumentKey,
  type: typeSystemType,
  name: "Document",
  description: "A top-level note made of ordered blocks.",
  fields: [
    fieldPathKey,
    titleFieldKey,
    [fieldBlockContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

const typeDocumentBlock = {
  id: newAppConfigId(10),
  uid: typeDocumentBlockUid,
  key: typeDocumentBlockKey,
  type: typeSystemType,
  name: "Document Block",
  description: "Abstract base for all blocks. Not instantiable.",
  fields: [],
} as const satisfies TypeDef;

export const typeSectionUid = "k9Vx2wBcBeF" as ConfigUid;
export const typeSectionKey = "Section" as NodeType;
const typeSection = {
  id: newAppConfigId(11),
  uid: typeSectionUid,
  key: typeSectionKey,
  type: typeSystemType,
  name: "Section",
  description: "A titled container with nested blocks.",
  fields: [
    [titleFieldKey, { required: true }],
    [fieldBlockContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

export const typeParagraphUid = "l0Wy3xCdCfG" as ConfigUid;
export const typeParagraphKey = "Paragraph" as NodeType;
const typeParagraph = {
  id: newAppConfigId(12),
  uid: typeParagraphUid,
  key: typeParagraphKey,
  type: typeSystemType,
  name: "Paragraph",
  description: "A text paragraph block.",
  fields: [[fieldTextContentKey, { required: true }]],
} as const satisfies TypeDef;

export const typeQuoteUid = "m1Xz4yDeDgH" as ConfigUid;
export const typeQuoteKey = "Quote" as NodeType;
const typeQuote = {
  id: newAppConfigId(13),
  uid: typeQuoteUid,
  key: typeQuoteKey,
  type: typeSystemType,
  name: "Quote",
  description: "A quoted text block.",
  fields: [[fieldTextContentKey, { required: true }], fieldCitationSourceKey],
} as const satisfies TypeDef;

export const typeCodeUid = "n2Ya5zEfEhI" as ConfigUid;
export const typeCodeKey = "Code" as NodeType;
const typeCode = {
  id: newAppConfigId(14),
  uid: typeCodeUid,
  key: typeCodeKey,
  type: typeSystemType,
  name: "Code",
  description: "A code block.",
  fields: [
    [fieldCodeLanguageKey, { required: true }],
    [fieldTextContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

export const typeDataviewUid = "o3Zb6aFgFiJ" as ConfigUid;
export const typeDataviewKey = "Dataview" as NodeType;
const typeDataview = {
  id: newAppConfigId(15),
  uid: typeDataviewUid,
  key: typeDataviewKey,
  type: typeSystemType,
  name: "Dataview",
  description: "A query-driven view block.",
  fields: [[fieldQueryKey, { required: true }], fieldTemplateKey],
} as const satisfies TypeDef;

export const typeListUid = "p4Ab7cGhGjK" as ConfigUid;
export const typeListKey = "List" as NodeType;
const typeList = {
  id: newAppConfigId(16),
  uid: typeListUid,
  key: typeListKey,
  type: typeSystemType,
  name: "List",
  description: "A list container.",
  fields: [[fieldBlockContentKey, { required: true }]],
} as const satisfies TypeDef;

export const typeListItemUid = "q5Bc8dHiHkL" as ConfigUid;
export const typeListItemKey = "ListItem" as NodeType;
const typeListItem = {
  id: newAppConfigId(17),
  uid: typeListItemUid,
  key: typeListItemKey,
  type: typeSystemType,
  name: "List Item",
  description: "A list item.",
  fields: [[fieldTextContentKey, { required: true }]],
} as const satisfies TypeDef;

export const documentSchemaTransactionInput: TransactionInput = {
  author: "system",
  createdAt: newIsoTimestamp("2024-10-05"),
  nodes: [],
  configurations: [
    changesetInputForNewEntity(fieldBlockContent),
    changesetInputForNewEntity(fieldTextContent),
    changesetInputForNewEntity(fieldHeadingLevel),
    changesetInputForNewEntity(fieldCitationSource),
    changesetInputForNewEntity(fieldCodeLanguage),
    changesetInputForNewEntity(fieldQuery),
    changesetInputForNewEntity(fieldTemplate),
    changesetInputForNewEntity(fieldPath),
    changesetInputForNewEntity(typeDocument),
    changesetInputForNewEntity(typeDocumentBlock),
    changesetInputForNewEntity(typeSection),
    changesetInputForNewEntity(typeParagraph),
    changesetInputForNewEntity(typeQuote),
    changesetInputForNewEntity(typeCode),
    changesetInputForNewEntity(typeDataview),
    changesetInputForNewEntity(typeList),
    changesetInputForNewEntity(typeListItem),
  ],
};

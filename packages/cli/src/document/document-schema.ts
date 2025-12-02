import { newIsoTimestamp } from "@binder/utils";
import {
  changesetInputForNewEntity,
  type ConfigId,
  type ConfigKey,
  type ConfigUid,
  fieldSystemType,
  type NodeFieldDef,
  type NodeType,
  relationFieldConfigType,
  type TransactionInput,
  type TypeDef,
  typeSystemType,
} from "@binder/db";

export const fieldTitleUid = "a7Kx2mPqRtU" as ConfigUid;
export const fieldTitleKey = "title" as ConfigKey;
const fieldTitle = {
  id: 1 as ConfigId,
  uid: fieldTitleUid,
  key: fieldTitleKey,
  type: fieldSystemType,
  name: "Title",
  description: "A few word description of the node.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const typeDocumentBlockUid = "j8Uw1vAbAdE" as ConfigUid;
export const typeDocumentBlockKey = "DocumentBlock" as NodeType;
export const fieldBlockContentUid = "b9Lm3nQrSvW" as ConfigUid;
export const fieldBlockContentKey = "blockContent" as ConfigKey;
const fieldBlockContent = {
  id: 2 as ConfigId,
  uid: fieldBlockContentUid,
  key: fieldBlockContentKey,
  type: relationFieldConfigType,
  name: "Block Content",
  description: "Ordered list of child blocks.",
  dataType: "relation",
  allowMultiple: true,
  range: [typeDocumentBlockKey],
} as const satisfies NodeFieldDef;

export const fieldTextContentUid = "c1Np4oRsTwX" as ConfigUid;
export const fieldTextContentKey = "textContent" as ConfigKey;
const fieldTextContent = {
  id: 3 as ConfigId,
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
  id: 4 as ConfigId,
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
  id: 5 as ConfigId,
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
  id: 6 as ConfigId,
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
  id: 7 as ConfigId,
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
  id: 8 as ConfigId,
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
  id: 9 as ConfigId,
  uid: fieldPathUid,
  key: fieldPathKey,
  type: fieldSystemType,
  name: "Path",
  description: "File system path.",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const fieldDescriptionUid = "s7De0fKlKmN" as ConfigUid;
export const fieldDescriptionKey = "description" as ConfigKey;
const fieldDescription = {
  id: 19 as ConfigId,
  uid: fieldDescriptionUid,
  key: fieldDescriptionKey,
  type: fieldSystemType,
  name: "Description",
  description: "A detailed multi word description with spaces for context.",
  dataType: "text",
} as const satisfies NodeFieldDef;

export const typeDocumentUid = "i7Tv0uZaZcD" as ConfigUid;
export const typeDocumentKey = "Document" as NodeType;
const typeDocument = {
  id: 10 as ConfigId,
  uid: typeDocumentUid,
  key: typeDocumentKey,
  type: typeSystemType,
  name: "Document",
  description: "A top-level note made of ordered blocks.",
  fields: [
    fieldPathKey,
    fieldTitleKey,
    [fieldBlockContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

const typeDocumentBlock = {
  id: 11 as ConfigId,
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
  id: 12 as ConfigId,
  uid: typeSectionUid,
  key: typeSectionKey,
  type: typeSystemType,
  name: "Section",
  description: "A titled container with nested blocks.",
  extends: typeDocumentBlockKey,
  fields: [
    [fieldTitleKey, { required: true }],
    [fieldBlockContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

export const typeParagraphUid = "l0Wy3xCdCfG" as ConfigUid;
export const typeParagraphKey = "Paragraph" as NodeType;
const typeParagraph = {
  id: 13 as ConfigId,
  uid: typeParagraphUid,
  key: typeParagraphKey,
  type: typeSystemType,
  name: "Paragraph",
  description: "A text paragraph block.",
  extends: typeDocumentBlockKey,
  fields: [[fieldTextContentKey, { required: true }]],
} as const satisfies TypeDef;

export const typeQuoteUid = "m1Xz4yDeDgH" as ConfigUid;
export const typeQuoteKey = "Quote" as NodeType;
const typeQuote = {
  id: 14 as ConfigId,
  uid: typeQuoteUid,
  key: typeQuoteKey,
  type: typeSystemType,
  name: "Quote",
  description: "A quoted text block.",
  extends: typeDocumentBlockKey,
  fields: [[fieldTextContentKey, { required: true }], fieldCitationSourceKey],
} as const satisfies TypeDef;

export const typeCodeUid = "n2Ya5zEfEhI" as ConfigUid;
export const typeCodeKey = "Code" as NodeType;
const typeCode = {
  id: 15 as ConfigId,
  uid: typeCodeUid,
  key: typeCodeKey,
  type: typeSystemType,
  name: "Code",
  description: "A code block.",
  extends: typeDocumentBlockKey,
  fields: [
    [fieldCodeLanguageKey, { required: true }],
    [fieldTextContentKey, { required: true }],
  ],
} as const satisfies TypeDef;

export const typeDataviewUid = "o3Zb6aFgFiJ" as ConfigUid;
export const typeDataviewKey = "Dataview" as NodeType;
const typeDataview = {
  id: 16 as ConfigId,
  uid: typeDataviewUid,
  key: typeDataviewKey,
  type: typeSystemType,
  name: "Dataview",
  description: "A query-driven view block.",
  extends: typeDocumentBlockKey,
  fields: [[fieldQueryKey, { required: true }], fieldTemplateKey],
} as const satisfies TypeDef;

export const typeListUid = "p4Ab7cGhGjK" as ConfigUid;
export const typeListKey = "List" as NodeType;
const typeList = {
  id: 17 as ConfigId,
  uid: typeListUid,
  key: typeListKey,
  type: typeSystemType,
  name: "List",
  description: "A list container.",
  extends: typeDocumentBlockKey,
  fields: [[fieldBlockContentKey, { required: true }]],
} as const satisfies TypeDef;

export const typeListItemUid = "q5Bc8dHiHkL" as ConfigUid;
export const typeListItemKey = "ListItem" as NodeType;
const typeListItem = {
  id: 18 as ConfigId,
  uid: typeListItemUid,
  key: typeListItemKey,
  type: typeSystemType,
  name: "List Item",
  description: "A list item.",
  extends: typeDocumentBlockKey,
  fields: [[fieldTextContentKey, { required: true }]],
} as const satisfies TypeDef;

export const documentSchemaTransactionInput: TransactionInput = {
  author: "system",
  createdAt: newIsoTimestamp("2024-10-05"),
  nodes: [],
  configurations: [
    changesetInputForNewEntity(fieldTitle),
    changesetInputForNewEntity(fieldBlockContent),
    changesetInputForNewEntity(fieldTextContent),
    changesetInputForNewEntity(fieldHeadingLevel),
    changesetInputForNewEntity(fieldCitationSource),
    changesetInputForNewEntity(fieldCodeLanguage),
    changesetInputForNewEntity(fieldQuery),
    changesetInputForNewEntity(fieldTemplate),
    changesetInputForNewEntity(fieldPath),
    changesetInputForNewEntity(fieldDescription),
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

import type { EntityId, EntityKey } from "./entity.ts";
import {
  type EntitySchema,
  type FieldDef,
  ID_RANGE_CORE_LIMIT,
  newId,
  coreFields,
} from "./schema.ts";
import {
  type CoreDataType,
  coreDataTypes,
  type DataTypeDefs,
} from "./data-type.ts";

/**
 * Record namespace field ID ranges.
 *
 * 0       16             64       101
 * ├───────┼──────────────┼────────┼──────────►
 * │ CORE  │   STANDARD   │  APP   │   USER
 * └───────┴──────────────┴────────┴──────────
 *
 * CORE     [1-15]:  Shared across all namespaces (see schema.ts).
 * STANDARD [16-63]: Predefined record fields.
 * APP      [64-100]: Application-defined record fields.
 * USER     [101+]:  User-defined record fields.
 */
export const STANDARD_ID_OFFSET = ID_RANGE_CORE_LIMIT;
export const STANDARD_ID_LIMIT = 64;
export const APP_RECORD_ID_OFFSET = STANDARD_ID_LIMIT;
export const APP_RECORD_ID_LIMIT = 101;
export const USER_RECORD_ID_OFFSET = APP_RECORD_ID_LIMIT;

const newStandardFieldId = (seq: number): EntityId =>
  newId(seq, STANDARD_ID_OFFSET);

export const standardIds = {
  title: newStandardFieldId(1),
  summary: newStandardFieldId(3),
  details: newStandardFieldId(4),
  content: newStandardFieldId(5),
  sourceFiles: newStandardFieldId(6),
  status: newStandardFieldId(7),
  priority: newStandardFieldId(8),
  url: newStandardFieldId(9),
  source: newStandardFieldId(10),
  dueDate: newStandardFieldId(11),
  startDate: newStandardFieldId(12),
  completedAt: newStandardFieldId(13),
  parent: newStandardFieldId(14),
  children: newStandardFieldId(15),
  next: newStandardFieldId(16),
  previous: newStandardFieldId(17),
  partOf: newStandardFieldId(18),
  contains: newStandardFieldId(19),
  requires: newStandardFieldId(20),
  requiredBy: newStandardFieldId(21),
  relatesTo: newStandardFieldId(22),
  references: newStandardFieldId(23),
  createdAt: newStandardFieldId(24),
  updatedAt: newStandardFieldId(25),
  createdBy: newStandardFieldId(26),
  updatedBy: newStandardFieldId(27),
} as const;

export const titleFieldKey = "title" as EntityKey;
export const summaryFieldKey = "summary" as EntityKey;
export const detailsFieldKey = "details" as EntityKey;
export const contentFieldKey = "content" as EntityKey;
export const sourceFilesFieldKey = "sourceFiles" as EntityKey;
export const statusFieldKey = "status" as EntityKey;
export const priorityFieldKey = "priority" as EntityKey;
export const urlFieldKey = "url" as EntityKey;
export const sourceFieldKey = "source" as EntityKey;
export const dueDateFieldKey = "dueDate" as EntityKey;
export const startDateFieldKey = "startDate" as EntityKey;
export const completedAtFieldKey = "completedAt" as EntityKey;
export const parentFieldKey = "parent" as EntityKey;
export const childrenFieldKey = "children" as EntityKey;
export const nextFieldKey = "next" as EntityKey;
export const previousFieldKey = "previous" as EntityKey;
export const partOfFieldKey = "partOf" as EntityKey;
export const containsFieldKey = "contains" as EntityKey;
export const requiresFieldKey = "requires" as EntityKey;
export const requiredByFieldKey = "requiredBy" as EntityKey;
export const relatesToFieldKey = "relatesTo" as EntityKey;
export const referencesFieldKey = "references" as EntityKey;
export const createdAtFieldKey = "createdAt" as EntityKey;
export const updatedAtFieldKey = "updatedAt" as EntityKey;
export const createdByFieldKey = "createdBy" as EntityKey;
export const updatedByFieldKey = "updatedBy" as EntityKey;

export const standardFields = {
  // Labeling
  title: {
    id: standardIds.title,
    key: titleFieldKey,
    name: "Title",
    dataType: "plaintext",
    plaintextFormat: "line",
    description: "Human-readable heading for content-oriented records.",
  },
  // Content
  summary: {
    id: standardIds.summary,
    key: summaryFieldKey,
    name: "Summary",
    dataType: "richtext",
    richtextFormat: "block",
    allowMultiple: true,
    description:
      "Short version of the body content. Written after the fact, unlike description which is upfront metadata.",
  },
  details: {
    id: standardIds.details,
    key: detailsFieldKey,
    name: "Details",
    dataType: "richtext",
    richtextFormat: "section",
    sectionDepth: 2,
    description:
      "Structured body section. Headings start at the level set by sectionDepth.",
  },
  content: {
    id: standardIds.content,
    key: contentFieldKey,
    name: "Content",
    dataType: "richtext",
    richtextFormat: "document",
    description: "Full document body with complete heading structure.",
  },
  // External
  url: {
    id: standardIds.url,
    key: urlFieldKey,
    name: "URL",
    dataType: "uri",
    description: "Primary external link.",
  },
  sourceFiles: {
    id: standardIds.sourceFiles,
    key: sourceFilesFieldKey,
    name: "Source Files",
    dataType: "plaintext",
    plaintextFormat: "filepath",
    allowMultiple: true,
    description: "Paths to relevant source code and files.",
  },
  references: {
    id: standardIds.references,
    key: referencesFieldKey,
    name: "References",
    dataType: "uri",
    allowMultiple: true,
    description: "Related external resources: docs, issues, specs, web pages.",
  },
  // Classification
  status: {
    id: standardIds.status,
    key: statusFieldKey,
    name: "Status",
    dataType: "option",
    options: [
      { key: "draft", name: "Draft" },
      { key: "pending", name: "Pending" },
      { key: "active", name: "Active" },
      { key: "paused", name: "Paused" },
      { key: "complete", name: "Complete" },
      { key: "cancelled", name: "Cancelled" },
    ],
    description: "Lifecycle state.",
  },
  priority: {
    id: standardIds.priority,
    key: priorityFieldKey,
    name: "Priority",
    dataType: "option",
    options: [
      { key: "p0", name: "Blocker" },
      { key: "p1", name: "Urgent" },
      { key: "p2", name: "High" },
      { key: "p3", name: "Medium" },
      { key: "p4", name: "Low" },
    ],
    description: "Importance or urgency level.",
  },
  source: {
    id: standardIds.source,
    key: sourceFieldKey,
    name: "Source",
    dataType: "plaintext",
    plaintextFormat: "line",
    description:
      "Where this record came from. Provenance label for imported or derived data.",
  },
  // Temporal
  dueDate: {
    id: standardIds.dueDate,
    key: dueDateFieldKey,
    name: "Due Date",
    dataType: "date",
    description: "Target completion date.",
  },
  startDate: {
    id: standardIds.startDate,
    key: startDateFieldKey,
    name: "Start Date",
    dataType: "date",
    description: "Date when work begins or becomes relevant.",
  },
  completedAt: {
    id: standardIds.completedAt,
    key: completedAtFieldKey,
    name: "Completed At",
    dataType: "datetime",
    description: "Timestamp when marked complete.",
  },
  // Structural
  parent: {
    id: standardIds.parent,
    key: parentFieldKey,
    name: "Parent",
    dataType: "relation",
    description: "Direct ancestor in a record hierarchy.",
  },
  children: {
    id: standardIds.children,
    key: childrenFieldKey,
    name: "Children",
    dataType: "relation",
    allowMultiple: true,
    inverseOf: parentFieldKey,
    description: "Direct descendants in a record hierarchy.",
  },
  next: {
    id: standardIds.next,
    key: nextFieldKey,
    name: "Next",
    dataType: "relation",
    description: "Next in an ordered sequence.",
  },
  previous: {
    id: standardIds.previous,
    key: previousFieldKey,
    name: "Previous",
    dataType: "relation",
    inverseOf: nextFieldKey,
    description: "Previous in an ordered sequence.",
  },
  partOf: {
    id: standardIds.partOf,
    key: partOfFieldKey,
    name: "Part Of",
    dataType: "relation",
    description: "The collection or set this belongs to.",
  },
  contains: {
    id: standardIds.contains,
    key: containsFieldKey,
    name: "Contains",
    dataType: "relation",
    allowMultiple: true,
    inverseOf: partOfFieldKey,
    description: "Records that belong to this collection.",
  },
  requires: {
    id: standardIds.requires,
    key: requiresFieldKey,
    name: "Requires",
    dataType: "relation",
    allowMultiple: true,
    description:
      "Prerequisites that must be completed before this can proceed.",
  },
  requiredBy: {
    id: standardIds.requiredBy,
    key: requiredByFieldKey,
    name: "Required By",
    dataType: "relation",
    allowMultiple: true,
    inverseOf: requiresFieldKey,
    description: "Dependents that are blocked until this is done.",
  },
  relatesTo: {
    id: standardIds.relatesTo,
    key: relatesToFieldKey,
    name: "Related To",
    dataType: "relation",
    allowMultiple: true,
    inverseOf: relatesToFieldKey,
    description: "Bidirectional association.",
  },
  // System-managed
  createdAt: {
    id: standardIds.createdAt,
    key: createdAtFieldKey,
    name: "Created At",
    dataType: "datetime",
    userReadonly: true,
    immutable: true,
    description: "When first created.",
  },
  updatedAt: {
    id: standardIds.updatedAt,
    key: updatedAtFieldKey,
    name: "Updated At",
    dataType: "datetime",
    userReadonly: true,
    description: "When last modified.",
  },
  createdBy: {
    id: standardIds.createdBy,
    key: createdByFieldKey,
    name: "Created By",
    dataType: "plaintext",
    plaintextFormat: "line",
    userReadonly: true,
    immutable: true,
    description: "Author of creation.",
  },
  updatedBy: {
    id: standardIds.updatedBy,
    key: updatedByFieldKey,
    name: "Updated By",
    dataType: "plaintext",
    plaintextFormat: "line",
    userReadonly: true,
    description: "Author of last modification.",
  },
} as const satisfies Record<string, FieldDef>;

export const predefinedFields = {
  ...coreFields,
  ...standardFields,
} as const;

export type StandardFieldKey = keyof typeof standardFields;
export type PredefinedFieldKey = keyof typeof predefinedFields;

export const standardFieldKeys = Object.keys(
  standardFields,
) as StandardFieldKey[];
export const predefinedFieldKeys = Object.keys(
  predefinedFields,
) as PredefinedFieldKey[];

export const recordDataTypes = {
  ...coreDataTypes,
  fileHash: { name: "File Hash", description: "SHA-256 hash of the file" },
  interval: {
    name: "Interval",
    description:
      "Format is not decided, something to store value of specific period, can be timezone relative or specific",
  },
  duration: { name: "Duration" },
  query: { name: "Query" },
  image: { name: "Image", description: "Image URL" },
} as const satisfies DataTypeDefs;

export type RecordDataType = keyof typeof recordDataTypes;
export type RecordFieldDef = FieldDef<RecordDataType>;
export type RecordSchema = EntitySchema<RecordDataType>;

/**
 * Base record schema with all predefined fields.
 * Used as the starting point, then merged with user-defined schema from config.
 */
export const coreRecordSchema = (): EntitySchema<CoreDataType> => ({
  fields: predefinedFields,
  types: {},
});

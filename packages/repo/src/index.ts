export {
  type KnowledgeGraph,
  type KnowledgeGraphCallbacks,
  type ReadonlyKnowledgeGraph,
  type TransactionRollback,
  openKnowledgeGraph,
} from "./knowledge-graph";
export {
  type Database,
  type DbTransaction,
  type DrizzleDb,
  type OpenDbMigrationContext,
  type OpenDbMigrationOptions,
  type OpenDbOptions,
  openDb,
} from "./db";
export * from "./model";
export type * from "./model";
export { entityTables } from "./schema";
export { validateDataType } from "./data-type-validators";
export {
  extractUid,
  getNestedValue,
  isFieldsetNested,
  parseFieldPath,
  setNestedValue,
} from "./model/field.ts";
export {
  getDelimiterString,
  getMultiValueDelimiter,
  isMultilineFormat,
  type MultiValueDelimiter,
  splitByDelimiter,
} from "./model/text-format.ts";
export { buildIncludes, pickByIncludes } from "./model/query.ts";
export {
  isComplexFilter,
  matchesFilter,
  matchesFilters,
} from "./filter-entities.ts";
export { createUid } from "./utils/uid.ts";
export { applyConfigChangesetToSchema } from "./changeset-applier.ts";
export { parseFieldValue, serializeFieldValue } from "./model/field.ts";

export {
  // Result types & guards
  type Err,
  type ErrorObject,
  type Ok,
  type Result,
  type ResultAsync,
  err,
  isErr,
  isOk,
  ok,
  okVoid,
  throwIfError,
  tryCatch,
  // Error construction
  createError,
  fail,
} from "@binder/utils";

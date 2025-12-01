import { includes } from "@binder/utils";
import type { EntityId, EntityKey, EntityType, EntityUid } from "./entity.ts";
import {
  type CoreDataType,
  type GetValueType,
  type OptionDef,
} from "./data-type.ts";
import type { FieldKey, FieldPath } from "./field.ts";

export type EntityTypeBuilder<
  D extends Record<string, unknown>,
  M extends keyof D,
  O extends keyof D,
> = {
  [K in M]: GetValueType<D[K]>;
} & {
  [K in O]?: GetValueType<D[K]>;
};

// IMPORTANT: We are using key to store config relations and uid for node relations
// Ids would be more efficient, but they would require more complex conflict resolution. That eventually might happen, possibly combined with a binary format for storing entities
export type FieldDef<D extends string = string> = {
  id: EntityId;
  key: EntityKey;
  uid?: EntityUid;
  type?: EntityType;
  name: string;
  description?: string;
  dataType: D;
  options?: OptionDef[];
  range?: EntityType[];
  uriPrefix?: string;
  allowMultiple?: boolean;
  inverseOf?: EntityKey;
  unique?: boolean;
  internal?: boolean;
  userReadonly?: boolean;
  immutable?: boolean;
};

export const newId = <T extends EntityId>(seq: number, offset: number) =>
  (offset + seq) as T;
export const coreIds = {
  id: newId(1, 0),
  uid: newId(2, 0),
  key: newId(3, 0),
  type: newId(4, 0),
  name: newId(5, 0),
  description: newId(6, 0),
} as const;
export const coreIdsLimit = 16;

export const coreFields = {
  id: {
    id: coreIds.id,
    key: "id" as EntityKey,
    name: "id",
    dataType: "seqId",
    immutable: true,
  },
  uid: {
    id: coreIds.uid,
    key: "uid" as EntityKey,
    name: "uid",
    dataType: "uid",
    immutable: true,
  },
  key: {
    id: coreIds.key,
    key: "key" as EntityKey,
    name: "Key",
    dataType: "string",
    description: "Unique key to identify the configuration record",
    unique: true,
  },
  type: {
    id: coreIds.type,
    key: "type" as EntityKey,
    name: "type",
    dataType: "string",
    immutable: true,
  },
  name: {
    id: coreIds.name,
    key: "name" as EntityKey,
    name: "name",
    dataType: "string",
  },
  description: {
    id: coreIds.description,
    key: "description" as EntityKey,
    name: "description",
    dataType: "text",
  },
} as const satisfies Record<string, FieldDef>;

export type FieldAttrDef = {
  required?: boolean;
  description?: string;
  default?: string | number | boolean;
  value?: string | number | boolean;
  exclude?: string[];
  only?: string[];
  min?: number;
};
export type FieldAttrDefs = Record<string, FieldAttrDef>;

export type TypeDef = {
  id: EntityId;
  key: EntityType;
  uid?: EntityUid;
  type?: EntityType;
  name: string;
  description?: string;
  extends?: EntityType;
  fields: FieldKey[];
  fields_attrs?: FieldAttrDefs;
};

export type EntitySchema<D extends string = string> = {
  fields: Record<FieldKey, FieldDef<D>>;
  types: Record<FieldKey, TypeDef>;
};

export const systemFieldKeys = [
  "id" as FieldKey,
  "uid" as FieldKey,
  "key" as FieldKey,
  "type" as FieldKey,
] as const satisfies FieldKey[];
export type SystemFieldKeys = "id" | "uid" | "key" | "type";
export const fieldSystemType = "Field" as EntityType;
export const typeSystemType = "Type" as EntityType;

export const isFieldInSchema = (
  fieldKey: string,
  schema: EntitySchema,
): boolean => includes(systemFieldKeys, fieldKey) || fieldKey in schema.fields;

export const getAllFieldsForType = (
  type: EntityType,
  schema: EntitySchema,
  includeSystemFields = true,
): FieldKey[] => {
  const typeDef = schema.types[type];
  if (!typeDef) return [];
  const fields = [...typeDef.fields];
  if (typeDef.extends) {
    fields.push(...getAllFieldsForType(typeDef.extends, schema, false));
  }
  if (includeSystemFields) {
    return [...systemFieldKeys, ...fields];
  }
  return fields;
};

export const getFieldDef = <D extends string = CoreDataType>(
  schema: EntitySchema<D>,
  field: FieldKey,
): FieldDef<D> | undefined => {
  if (field in coreFields) {
    return coreFields[field as keyof typeof coreFields] as FieldDef<D>;
  }
  return schema.fields[field];
};

export const getFieldDefNested = <D extends string = CoreDataType>(
  schema: EntitySchema<D>,
  path: FieldPath,
): FieldDef<D> | undefined => {
  const firstKey = path[0]!;

  if (path.length === 1 && firstKey in coreFields) {
    return coreFields[firstKey as keyof typeof coreFields] as FieldDef<D>;
  }

  let currentField = schema.fields[firstKey];

  if (path.length === 1) return currentField;
  if (!currentField) return;

  for (let i = 1; i < path.length; i++) {
    if (currentField.dataType !== "relation") return;

    if (!currentField.range || currentField.range.length === 0) return;

    const nextFieldKey = path[i]!;
    const nextFieldDef = schema.fields[nextFieldKey];
    if (!nextFieldDef) return;

    const rangeType = currentField.range[0]!;
    const allFields = getAllFieldsForType(rangeType, schema);
    if (!allFields.includes(nextFieldKey)) return;

    currentField = nextFieldDef;
  }

  return currentField;
};

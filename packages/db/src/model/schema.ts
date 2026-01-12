import { assertCheck, groupByToObject, type JsonValue } from "@binder/utils";
import type { EntityId, EntityKey, EntityType, EntityUid } from "./entity.ts";
import {
  type CoreDataType,
  type GetValueType,
  type OptionDef,
  type PeriodFormat,
  type PlaintextFormat,
  type RichtextFormat,
} from "./data-type.ts";
import {
  isFieldsetNested,
  type FieldKey,
  type FieldPath,
  type FieldsetNested,
} from "./field.ts";
import type { Filters } from "./query.ts";

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
  attributes?: FieldKey[];
  when?: Filters;
  default?: JsonValue;
  plaintextFormat?: PlaintextFormat;
  richtextFormat?: RichtextFormat;
  periodFormat?: PeriodFormat;
};

export const newId = <T extends EntityId>(seq: number, offset: number) =>
  (offset + seq) as T;

export const validateIdInRange = <T extends EntityId>(
  id: T,
  offset: number,
  limit: number = Number.MAX_SAFE_INTEGER,
): void =>
  assertCheck(
    id >= offset && id < limit,
    "id",
    `Expected id to be in range (${offset}-${limit}) but was ${id}`,
  );

export const ID_RANGE_CORE_LIMIT = 16;

export const coreIds = {
  id: newId(1, 0),
  uid: newId(2, 0),
  key: newId(3, 0),
  type: newId(4, 0),
  name: newId(5, 0),
  title: newId(6, 0),
  description: newId(7, 0),
  parent: newId(8, 0),
  children: newId(9, 0),
} as const;

export const titleFieldKey = "title" as EntityKey;
export const descriptionFieldKey = "description" as EntityKey;
export const nameFieldKey = "name" as EntityKey;
export const parentFieldKey = "parent" as EntityKey;
export const childrenFieldKey = "children" as EntityKey;
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
    dataType: "plaintext",
    plaintextFormat: "identifier",
    description: "Unique key to identify the configuration record",
    unique: true,
  },
  type: {
    id: coreIds.type,
    key: "type" as EntityKey,
    name: "type",
    dataType: "plaintext",
    plaintextFormat: "identifier",
    immutable: true,
  },
  name: {
    id: coreIds.name,
    key: nameFieldKey,
    name: "name",
    dataType: "plaintext",
    plaintextFormat: "line",
  },
  title: {
    id: coreIds.title,
    key: titleFieldKey,
    name: "title",
    dataType: "plaintext",
    plaintextFormat: "line",
  },
  description: {
    id: coreIds.description,
    key: descriptionFieldKey,
    name: "description",
    dataType: "richtext",
    richtextFormat: "block",
  },
  parent: {
    id: coreIds.parent,
    key: parentFieldKey,
    name: "Parent",
    dataType: "relation",
    description: "Parent entity in hierarchical structure",
  },
  children: {
    id: coreIds.children,
    key: childrenFieldKey,
    name: "Children",
    dataType: "relation",
    description: "Child entities in hierarchical structure",
    allowMultiple: true,
    inverseOf: parentFieldKey,
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

export type TypeFieldRef<K extends string = FieldKey> = K | [K, FieldAttrDef];

export const getTypeFieldKey = <K extends string>(ref: TypeFieldRef<K>): K =>
  Array.isArray(ref) ? ref[0] : ref;

export const getTypeFieldAttrs = <K extends string>(
  ref: TypeFieldRef<K>,
): FieldAttrDef | undefined => (Array.isArray(ref) ? ref[1] : undefined);

export type TypeDef<K extends string = FieldKey> = {
  id: EntityId;
  key: EntityType;
  uid?: EntityUid;
  type?: EntityType;
  name: string;
  description?: string;
  fields: TypeFieldRef<K>[];
};

export type EntitySchema<D extends string = string> = {
  fields: Record<FieldKey, FieldDef<D>>;
  types: Record<FieldKey, TypeDef>;
};

export const coreIdentityFieldKeys = ["id", "uid", "key", "type"] as const;
export type CoreIdentityFieldKey = (typeof coreIdentityFieldKeys)[number];
export type CoreFieldKey = keyof typeof coreFields;

export const coreFieldKeys = Object.keys(coreFields) as CoreFieldKey[];
export const fieldSystemType = "Field" as EntityType;
export const typeSystemType = "Type" as EntityType;

export const getAllFieldsForType = (
  type: EntityType,
  schema: EntitySchema,
  includeIdentityFields = true,
): FieldKey[] => {
  const typeDef = schema.types[type];
  if (!typeDef) return [];
  const fields = typeDef.fields.map(getTypeFieldKey);
  return includeIdentityFields ? [...coreIdentityFieldKeys, ...fields] : fields;
};

const isCoreIdentityFieldKey = (key: string): key is CoreIdentityFieldKey =>
  coreIdentityFieldKeys.includes(key as CoreIdentityFieldKey);

export const getFieldDefNested = <D extends string = CoreDataType>(
  schema: EntitySchema<D>,
  path: FieldPath,
): FieldDef<D> | undefined => {
  if (path.length === 0) return;

  const firstKey = path[0];
  if (path.length === 1) return schema.fields[firstKey];

  let currentField = schema.fields[firstKey];
  if (!currentField) return;

  for (let i = 1; i < path.length; i++) {
    if (currentField.dataType !== "relation") return;

    const nextFieldKey = path[i]!;
    const nextFieldDef = schema.fields[nextFieldKey];
    if (!nextFieldDef) return;

    currentField = nextFieldDef;
  }
  return currentField;
};

export const emptySchema = <D extends string>(): EntitySchema<D> => ({
  fields: {},
  types: {},
});

export const coreSchema = (): EntitySchema<CoreDataType> => ({
  fields: coreFields,
  types: {},
});

export const mergeSchema = <D extends string>(
  a: EntitySchema<D> = emptySchema(),
  b: EntitySchema<D> = emptySchema(),
): EntitySchema<D> => {
  return {
    fields: { ...a.fields, ...b.fields },
    types: { ...a.types, ...b.types },
  };
};

export const createSchema = <D extends string>(
  fields: FieldDef<D>[],
  types: TypeDef[],
): EntitySchema<D> => ({
  fields: groupByToObject(fields, (f) => f.key),
  types: groupByToObject(types, (t) => t.key),
});

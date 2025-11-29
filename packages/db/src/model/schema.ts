import { includes } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import {
  type CoreDataType,
  coreDataTypes,
  type DataTypeDefs,
  dataTypeDefsToOptions,
  type GetValueType,
  type OptionDef,
} from "./data-type.ts";
import type {
  ConfigId,
  ConfigKey,
  ConfigRelation,
  ConfigType,
} from "./config.ts";
import type { NodeFieldKey, NodeType } from "./node.ts";
import type {
  EntityNsSchema,
  EntityNsType,
  NamespaceEditable,
} from "./namespace.ts";
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
export type FieldDef<T> = {
  id: EntityId;
  key: EntityKey;
  uid?: EntityUid;
  name: string;
  description?: string;
  dataType: T;
  options?: OptionDef[];
  range?: ConfigRelation[];
  // rangeQuery?: string;
  domain?: ConfigRelation[];
  uriPrefix?: string;
  allowMultiple?: boolean;
  inverseOf?: ConfigRelation;
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

export type FieldDefs = Record<string, FieldDef<CoreDataType>>;
export const coreFields = {
  id: {
    id: coreIds.id,
    key: "id",
    name: "id",
    dataType: "seqId",
    immutable: true,
  },
  uid: {
    id: coreIds.uid,
    key: "uid",
    name: "uid",
    dataType: "uid",
    immutable: true,
  },
  key: {
    id: coreIds.key,
    key: "key",
    name: "Key",
    dataType: "string",
    description: "Unique key to identify the configuration record",
    unique: true,
  },
  type: {
    id: coreIds.type,
    key: "type",
    name: "type",
    dataType: "string",
    immutable: true,
  },
  name: {
    id: coreIds.name,
    key: "name",
    name: "name",
    dataType: "string",
  },
  description: {
    id: coreIds.description,
    key: "description",
    name: "description",
    dataType: "text",
  },
} as const satisfies FieldDefs;

export const configSchemaIds = {
  dataType: newId<ConfigId>(1, coreIdsLimit),
  options: newId<ConfigId>(2, coreIdsLimit),
  domain: newId<ConfigId>(3, coreIdsLimit),
  range: newId<ConfigId>(4, coreIdsLimit),
  allowMultiple: newId<ConfigId>(5, coreIdsLimit),
  inverseOf: newId<ConfigId>(6, coreIdsLimit),
  fields: newId<ConfigId>(7, coreIdsLimit),
  immutable: newId<ConfigId>(8, coreIdsLimit),
  disabled: newId<ConfigId>(9, coreIdsLimit),
  extends: newId<ConfigId>(10, coreIdsLimit),
  unique: newId<ConfigId>(11, coreIdsLimit),
  fields_attrs: newId<ConfigId>(12, coreIdsLimit),
  Field: newId<ConfigId>(14, coreIdsLimit),
  Type: newId<ConfigId>(15, coreIdsLimit),
  RelationField: newId<ConfigId>(16, coreIdsLimit),
  StringField: newId<ConfigId>(17, coreIdsLimit),
  OptionField: newId<ConfigId>(18, coreIdsLimit),
} as const;

export type FieldAttrDef = {
  required?: boolean;
  description?: string;
  default?: string | number | boolean;
  value?: string | number | boolean;
  exclude?: string[];
  only?: string[];
  min?: number;
};
export type FieldAttrDefs = Record<FieldKey, FieldAttrDef>;

export const nodeDataTypes = {
  ...coreDataTypes,
  fileHash: { name: "File Hash", description: "SHA-256 hash of the file" },
  interval: {
    name: "Interval",
    description:
      "Format is not decided, something to store value of specific period, can be timezone relative or specific",
  },
  duration: { name: "Duration" },
  uri: {
    name: "URI",
    description: "URI reference to the record in the external system",
  },
  image: { name: "Image", description: "Image URL" },
} as const satisfies DataTypeDefs;

export const fieldConfigType = "Field" as ConfigType;
export const relationFieldConfigType = "RelationField" as ConfigType;
export const stringFieldConfigType = "StringField" as ConfigType;
export const optionFieldConfigType = "OptionField" as ConfigType;
export const typeConfigType = "Type" as ConfigType;

export const fieldNodeTypes = [
  fieldConfigType,
  relationFieldConfigType,
  stringFieldConfigType,
  optionFieldConfigType,
] as const;

export const configFields = {
  ...coreFields,
  dataType: {
    id: configSchemaIds.dataType,
    key: "dataType",
    name: "Data Type",
    dataType: "option",
    options: dataTypeDefsToOptions(coreDataTypes),
    immutable: true,
  },
  options: {
    id: configSchemaIds.options,
    key: "options",
    name: "options",
    dataType: "optionSet",
  },
  domain: {
    id: configSchemaIds.domain,
    key: "record",
    name: "Domain",
    dataType: "relation",
    allowMultiple: true,
  },
  range: {
    id: configSchemaIds.range,
    key: "range",
    name: "range",
    dataType: "relation",
    allowMultiple: true,
  },
  allowMultiple: {
    id: configSchemaIds.allowMultiple,
    key: "allowMultiple",
    name: "Allow Multiple",
    dataType: "boolean",
    description: "Whether multiple values are allowed for this property",
    immutable: true,
  },
  inverseOf: {
    id: configSchemaIds.inverseOf,
    key: "inverseOf",
    name: "Inverse relation of",
    dataType: "relation",
    description: "Attribute of which this attribute is an inverse relation of",
    immutable: true,
  },
  // rangeQuery: { key: "rangeQuery", name: "Range Query", dataType: "query" },
  // formula: { key: "formula", name: "formula", dataType: "formula" },
  fields: {
    id: configSchemaIds.fields,
    key: "fields",
    name: "Fields",
    dataType: "relation",
    allowMultiple: true,
  },
  immutable: {
    id: configSchemaIds.immutable,
    key: "immutable",
    name: "Immutable",
    dataType: "boolean",
    description: "If true, this field cannot be modified after entity creation",
  },
  disabled: {
    id: configSchemaIds.disabled,
    key: "disabled",
    name: "Disabled",
    dataType: "boolean",
    description: "Indicates if this entity is disabled",
  },
  extends: {
    id: configSchemaIds.extends,
    key: "extends",
    name: "Extends",
    dataType: "relation",
    range: [typeConfigType],
  },
  unique: {
    id: configSchemaIds.unique,
    key: "unique",
    name: "Unique",
    dataType: "boolean",
    description: "Whether the field value must be unique",
    immutable: true,
  },
  fields_attrs: {
    id: configSchemaIds.fields_attrs,
    key: "fields_attrs",
    name: "Fields Attrs",
    dataType: "object",
    description: "Temporary hack field for fields attributes",
    immutable: true,
  },
} as const satisfies FieldDefs;
export type ConfigFieldDefinitions = typeof configFields;
export type ConfigFieldKey = keyof ConfigFieldDefinitions;

export type ConfigTypeDefinition = {
  id: ConfigId;
  key: ConfigKey;
  name: string;
  description: string;
  extends?: ConfigType;
  fields: ConfigFieldKey[];
  fields_attrs?: FieldAttrDefs;
};
export type ConfigTypeDefinitions = Record<ConfigType, ConfigTypeDefinition>;

/**
 * Require to define database configuration including records schema®
 */
export const configTypeDefs: ConfigTypeDefinitions = {
  [fieldConfigType]: {
    id: configSchemaIds.Field,
    key: fieldConfigType,
    name: "Attribute",
    description: "Configuration field definition",
    fields: ["key", "name", "dataType", "description", "allowMultiple"],
    fields_attrs: {
      key: { required: true },
      dataType: { required: true },
    },
  },
  [relationFieldConfigType]: {
    id: configSchemaIds.RelationField,
    key: relationFieldConfigType,
    name: "Attribute",
    description: "Configuration field definition",
    extends: fieldConfigType,
    fields: ["domain", "range", "inverseOf"],
    fields_attrs: {
      dataType: { value: "relation" },
    },
  },
  [stringFieldConfigType]: {
    id: configSchemaIds.StringField,
    key: stringFieldConfigType,
    name: "String Attribute",
    description: "String field with optional unique constraint",
    extends: fieldConfigType,
    fields: ["unique"],
    fields_attrs: {
      dataType: { value: "string" },
    },
  },
  [optionFieldConfigType]: {
    id: configSchemaIds.OptionField,
    key: optionFieldConfigType,
    name: "Option Attribute",
    description: "Option field with predefined choices",
    extends: fieldConfigType,
    fields: ["options"],
    fields_attrs: {
      dataType: { value: "option" },
    },
  },
  [typeConfigType]: {
    id: configSchemaIds.Type,
    key: typeConfigType,
    name: "Type",
    description: "Configuration entity type definition",
    fields: ["key", "name", "description", "fields", "extends"],
    fields_attrs: {
      key: { required: true },
    },
  },
} as const;

export type ConfigSchema = {
  fields: ConfigFieldDefinitions;
  types: ConfigTypeDefinitions;
};

export const configSchema = {
  fields: configFields,
  types: configTypeDefs,
} as const satisfies ConfigSchema;

export const systemFieldKeys = [
  "id",
  "uid",
  "key",
  "type",
  "fields_attrs", // temporary hack
] as const satisfies ConfigFieldKey[];
type SystemFieldKeys = "id" | "uid" | "key" | "type";
export type ConfigTypeBuilder<
  M extends ConfigFieldKey,
  O extends ConfigFieldKey,
> = EntityTypeBuilder<ConfigFieldDefinitions, M | SystemFieldKeys, O> & {};

export type NodeDataType = keyof typeof nodeDataTypes;
export type NodeFieldDefinition = ConfigTypeBuilder<
  "name",
  | "description"
  | "options"
  | "range"
  | "domain"
  | "allowMultiple"
  | "inverseOf"
  | "unique"
> & {
  dataType: NodeDataType;
};
export type NodeFieldDefinitions = Record<NodeFieldKey, NodeFieldDefinition>;

export type NodeTypeDefinition = ConfigTypeBuilder<
  "name" | "fields",
  "extends" | "description"
> & {
  fields_attrs?: FieldAttrDefs;
};
export type NodeTypeDefinitions = Record<NodeType, NodeTypeDefinition>;

export type NodeSchema = {
  fields: NodeFieldDefinitions;
  types: NodeTypeDefinitions;
};

export const emptyNodeSchema: NodeSchema = {
  fields: {},
  types: {},
};

export type EntitySchema = NodeSchema | ConfigSchema;
export const isFieldInSchema = (
  fieldKey: string,
  schema: EntitySchema,
): boolean => includes(systemFieldKeys, fieldKey) || fieldKey in schema.fields;

export const getAllFieldsForType = <N extends NamespaceEditable>(
  type: EntityNsType[N],
  schema: EntityNsSchema[N],
  includeSystemFields = true,
): string[] => {
  const typeDef = (schema.types as any)[type];
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

export const getFieldDef = (
  schema: EntitySchema,
  field: FieldKey,
): FieldDef<CoreDataType> | undefined => {
  if (field in coreFields) {
    return coreFields[field as keyof typeof coreFields];
  }
  return (schema.fields as any)[field] as FieldDef<CoreDataType>;
};

export const getFieldDefNested = (
  schema: EntitySchema,
  path: FieldPath,
): FieldDef<CoreDataType> | undefined => {
  const firstKey = path[0]!;

  if (path.length === 1 && firstKey in coreFields) {
    return coreFields[firstKey as keyof typeof coreFields];
  }

  let currentField = (schema.fields as any)[firstKey] as FieldDef<CoreDataType>;

  if (path.length === 1) return currentField;

  for (let i = 1; i < path.length; i++) {
    if (currentField.dataType !== "relation") return;

    if (!currentField.range || currentField.range.length === 0) return;

    const rangeType = currentField.range[0]! as keyof typeof schema.types;
    const typeDef = (schema.types as any)[rangeType];

    if (!typeDef) return;

    const nextFieldKey = path[i]!;
    const nextFieldDef = (schema.fields as any)[
      nextFieldKey
    ] as FieldDef<CoreDataType>;

    if (!nextFieldDef) return;

    const allFields = getAllFieldsForType(rangeType, schema);
    if (!allFields.includes(nextFieldKey)) return;

    currentField = nextFieldDef;
  }

  return currentField;
};

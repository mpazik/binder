import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import {
  coreDataTypes,
  type DataTypeDefs,
  dataTypeDefsToOptions,
} from "./data-type.ts";
import {
  coreFields,
  coreIdsLimit,
  type EntitySchema,
  type EntityTypeBuilder,
  type FieldAttrDefs,
  type FieldDef,
  fieldSystemType,
  newId,
  type SystemFieldKeys,
  typeSystemType,
} from "./schema.ts";
import { nodeDataTypes } from "./node.ts";
import type { FieldKey } from "./field.ts";

export type ConfigId = EntityId;
export type ConfigUid = EntityUid;
export type ConfigKey = EntityKey;
export type ConfigType = ConfigKey;
export type ConfigRef = ConfigId | ConfigUid | ConfigKey;
export type ConfigRelation = ConfigKey;

export const configDataTypes = {
  ...coreDataTypes,
  object: { name: "Object" },
  option: { name: "Option", description: "Option value" },
  optionSet: {
    name: "Option Set",
    description: "Set of options to choose from",
  },
} as const satisfies DataTypeDefs;
export type ConfigDataType = keyof typeof configDataTypes;

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

export const relationFieldConfigType = "RelationField" as ConfigType;
export const stringFieldConfigType = "StringField" as ConfigType;
export const optionFieldConfigType = "OptionField" as ConfigType;
export const fieldTypes = [
  fieldSystemType,
  relationFieldConfigType,
  stringFieldConfigType,
  optionFieldConfigType,
] as const;

export type ConfigFieldDef = FieldDef<ConfigDataType>;
export const configFields = {
  ...coreFields,
  dataType: {
    id: configSchemaIds.dataType,
    key: "dataType" as ConfigKey,
    name: "Data Type",
    dataType: "option",
    options: dataTypeDefsToOptions(nodeDataTypes),
    immutable: true,
  },
  options: {
    id: configSchemaIds.options,
    key: "options" as ConfigKey,
    name: "options",
    dataType: "optionSet",
  },
  domain: {
    id: configSchemaIds.domain,
    key: "record" as ConfigKey,
    name: "Domain",
    dataType: "relation",
    allowMultiple: true,
  },
  range: {
    id: configSchemaIds.range,
    key: "range" as ConfigKey,
    name: "range",
    dataType: "relation",
    allowMultiple: true,
  },
  allowMultiple: {
    id: configSchemaIds.allowMultiple,
    key: "allowMultiple" as ConfigKey,
    name: "Allow Multiple",
    dataType: "boolean",
    description: "Whether multiple values are allowed for this property",
    immutable: true,
  },
  inverseOf: {
    id: configSchemaIds.inverseOf,
    key: "inverseOf" as ConfigKey,
    name: "Inverse relation of",
    dataType: "relation",
    description: "Attribute of which this attribute is an inverse relation of",
    immutable: true,
  },
  // rangeQuery: { key: "rangeQuery", name: "Range Query", dataType: "query" },
  // formula: { key: "formula", name: "formula", dataType: "formula" },
  fields: {
    id: configSchemaIds.fields,
    key: "fields" as ConfigKey,
    name: "Fields",
    dataType: "relation",
    allowMultiple: true,
  },
  immutable: {
    id: configSchemaIds.immutable,
    key: "immutable" as ConfigKey,
    name: "Immutable",
    dataType: "boolean",
    description: "If true, this field cannot be modified after entity creation",
  },
  disabled: {
    id: configSchemaIds.disabled,
    key: "disabled" as ConfigKey,
    name: "Disabled",
    dataType: "boolean",
    description: "Indicates if this entity is disabled",
  },
  extends: {
    id: configSchemaIds.extends,
    key: "extends" as ConfigKey,
    name: "Extends",
    dataType: "relation",
    range: [typeSystemType],
  },
  unique: {
    id: configSchemaIds.unique,
    key: "unique" as ConfigKey,
    name: "Unique",
    dataType: "boolean",
    description: "Whether the field value must be unique",
    immutable: true,
  },
  fields_attrs: {
    id: configSchemaIds.fields_attrs,
    key: "fields_attrs" as ConfigKey,
    name: "Fields Attrs",
    dataType: "object",
    description: "Temporary hack field for fields attributes",
    immutable: true,
  },
} as const satisfies Record<FieldKey, ConfigFieldDef>;

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
  [fieldSystemType]: {
    id: configSchemaIds.Field,
    key: fieldSystemType,
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
    extends: fieldSystemType,
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
    extends: fieldSystemType,
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
    extends: fieldSystemType,
    fields: ["options"],
    fields_attrs: {
      dataType: { value: "option" },
    },
  },
  [typeSystemType]: {
    id: configSchemaIds.Type,
    key: typeSystemType,
    name: "Type",
    description: "Configuration entity type definition",
    fields: ["key", "name", "description", "fields", "extends"],
    fields_attrs: {
      key: { required: true },
    },
  },
} as const;
export type ConfigTypeBuilder<
  M extends ConfigFieldKey,
  O extends ConfigFieldKey,
> = EntityTypeBuilder<ConfigFieldDefinitions, M | SystemFieldKeys, O> & {};
export type ConfigSchema = EntitySchema<ConfigDataType> & {
  fields: ConfigFieldDefinitions;
  types: ConfigTypeDefinitions;
};

export const coreConfigSchema = {
  fields: configFields,
  types: configTypeDefs,
} as const satisfies ConfigSchema;

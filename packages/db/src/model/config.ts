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
  type FieldDef,
  fieldSystemType,
  newId,
  type SystemFieldKeys,
  type TypeFieldRef,
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
  unique: newId<ConfigId>(11, coreIdsLimit),
  attributes: newId<ConfigId>(12, coreIdsLimit),
  Field: newId<ConfigId>(13, coreIdsLimit),
  Type: newId<ConfigId>(14, coreIdsLimit),
  required: newId<ConfigId>(18, coreIdsLimit),
  default: newId<ConfigId>(19, coreIdsLimit),
  value: newId<ConfigId>(20, coreIdsLimit),
  exclude: newId<ConfigId>(21, coreIdsLimit),
  only: newId<ConfigId>(22, coreIdsLimit),
  when: newId<ConfigId>(23, coreIdsLimit),
} as const;

export const fieldTypes = [fieldSystemType] as const;

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
    when: { dataType: "option" },
  },
  domain: {
    id: configSchemaIds.domain,
    key: "record" as ConfigKey,
    name: "Domain",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
  },
  range: {
    id: configSchemaIds.range,
    key: "range" as ConfigKey,
    name: "range",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
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
    when: { dataType: "relation" },
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
  unique: {
    id: configSchemaIds.unique,
    key: "unique" as ConfigKey,
    name: "Unique",
    dataType: "boolean",
    description: "Whether the field value must be unique",
    immutable: true,
    when: { dataType: "string" },
  },
  attributes: {
    id: configSchemaIds.attributes,
    key: "attributes" as ConfigKey,
    name: "Attributes",
    dataType: "relation",
    description: "Allowed attribute fields for this field when used in types",
    range: [fieldSystemType],
    allowMultiple: true,
  },
  required: {
    id: configSchemaIds.required,
    key: "required" as ConfigKey,
    name: "Required",
    dataType: "boolean",
    description: "Whether the field is required",
  },
  default: {
    id: configSchemaIds.default,
    key: "default" as ConfigKey,
    name: "Default",
    dataType: "string",
    description: "Default value for the field",
  },
  value: {
    id: configSchemaIds.value,
    key: "value" as ConfigKey,
    name: "Value",
    dataType: "string",
    description: "Fixed value constraint for the field",
  },
  exclude: {
    id: configSchemaIds.exclude,
    key: "exclude" as ConfigKey,
    name: "Exclude",
    dataType: "string",
    description: "Excluded option values",
    allowMultiple: true,
  },
  only: {
    id: configSchemaIds.only,
    key: "only" as ConfigKey,
    name: "Only",
    dataType: "string",
    description: "Allowed option values",
    allowMultiple: true,
  },
  when: {
    id: configSchemaIds.when,
    key: "when" as ConfigKey,
    name: "When",
    dataType: "object",
    description: "Condition filters for when this field is applicable",
  },
} as const satisfies Record<FieldKey, ConfigFieldDef>;

export type ConfigFieldDefinitions = typeof configFields;
export type ConfigFieldKey = keyof ConfigFieldDefinitions;
export type ConfigTypeDefinition = {
  id: ConfigId;
  key: ConfigKey;
  name: string;
  description: string;
  fields: TypeFieldRef<ConfigFieldKey>[];
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
    fields: [
      ["key", { required: true }],
      "name",
      ["dataType", { required: true }],
      "description",
      "allowMultiple",
      "attributes",
      "domain",
      "range",
      "inverseOf",
      "unique",
      "options",
      "when",
    ],
  },
  [typeSystemType]: {
    id: configSchemaIds.Type,
    key: typeSystemType,
    name: "Type",
    description: "Configuration entity type definition",
    fields: [["key", { required: true }], "name", "description", "fields"],
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

import type { EntityId, EntityKey } from "./entity.ts";
import {
  coreFields,
  type CoreIdentityFieldKey,
  type EntitySchema,
  type EntityTypeBuilder,
  type FieldDef,
  fieldSystemType,
  ID_RANGE_CORE_LIMIT,
  newId,
  type TypeFieldRef,
  typeSystemType,
  validateIdInRange,
} from "./schema.ts";
import {
  coreDataTypes,
  type DataTypeDefs,
  dataTypeDefsToOptions,
  periodFormatOptions,
  plaintextFormatOptions,
  richtextFormatOptions,
} from "./data-type.ts";
import type { FieldKey } from "./field.ts";
import {
  type ConfigId,
  type ConfigKey,
  type ConfigType,
  nodeDataTypes,
} from "./config.ts";

/**
 * System Namespace IDs (Hardcoded Meta-Schema)
 *
 * 0      16        100
 * ├──────┼──────────┼───────────►
 * │ CORE │   META   │   APP
 * └──────┴──────────┴───────────
 *
 * CORE (0-15):  Identity fields (id, key)
 * META (16-99): Base schema (Field, Type, dataType...)
 * APP (100+):   App-defined meta-schema
 */

export type SystemId = EntityId;
export type SystemKey = EntityKey;

export const META_SYSTEM_ID_OFFSET = ID_RANGE_CORE_LIMIT;
export const APP_SYSTEM_ID_OFFSET = 100;

export const newMetaSystemId = (seq: number): SystemId =>
  newId(seq, META_SYSTEM_ID_OFFSET);

export const newAppSystemId = (seq: number): SystemId =>
  newId(seq, APP_SYSTEM_ID_OFFSET);

export const configDataTypes = {
  ...coreDataTypes,
  object: { name: "Object" },
  json: { name: "JSON", description: "Any JSON value" },
  option: { name: "Option", description: "Option value" },
  optionSet: {
    name: "Option Set",
    description: "Set of options to choose from",
  },
  query: { name: "Query", description: "Query parameters" },
} as const satisfies DataTypeDefs;
export type ConfigDataType = keyof typeof configDataTypes;

export const configSchemaIds = {
  dataType: newMetaSystemId(1),
  options: newMetaSystemId(2),
  domain: newMetaSystemId(3),
  range: newMetaSystemId(4),
  allowMultiple: newMetaSystemId(5),
  inverseOf: newMetaSystemId(6),
  fields: newMetaSystemId(7),
  immutable: newMetaSystemId(8),
  disabled: newMetaSystemId(9),
  unique: newMetaSystemId(11),
  attributes: newMetaSystemId(12),
  Field: newMetaSystemId(13),
  Type: newMetaSystemId(14),
  required: newMetaSystemId(18),
  default: newMetaSystemId(19),
  value: newMetaSystemId(20),
  exclude: newMetaSystemId(21),
  only: newMetaSystemId(22),
  when: newMetaSystemId(23),
  query: newMetaSystemId(24),
  children: newMetaSystemId(25),
  parent: newMetaSystemId(26),
  where: newMetaSystemId(27),
  includes: newMetaSystemId(28),
  plaintextFormat: newMetaSystemId(29),
  richtextFormat: newMetaSystemId(30),
  periodFormat: newMetaSystemId(31),
} as const;
export const fieldTypes = [fieldSystemType] as const;
export type ConfigFieldDef = FieldDef<ConfigDataType>;
export const configFieldsDefs = {
  ...coreFields,
  dataType: {
    id: configSchemaIds.dataType,
    key: "dataType" as SystemKey,
    name: "Data Type",
    dataType: "option",
    options: dataTypeDefsToOptions(nodeDataTypes),
    immutable: true,
  },
  options: {
    id: configSchemaIds.options,
    key: "options" as SystemKey,
    name: "options",
    dataType: "optionSet",
    when: { dataType: "option" },
  },
  domain: {
    id: configSchemaIds.domain,
    key: "record" as SystemKey,
    name: "Domain",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
  },
  range: {
    id: configSchemaIds.range,
    key: "range" as SystemKey,
    name: "range",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
  },
  allowMultiple: {
    id: configSchemaIds.allowMultiple,
    key: "allowMultiple" as SystemKey,
    name: "Allow Multiple",
    dataType: "boolean",
    description: "Whether multiple values are allowed for this property",
    immutable: true,
  },
  inverseOf: {
    id: configSchemaIds.inverseOf,
    key: "inverseOf" as SystemKey,
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
    key: "fields" as SystemKey,
    name: "Fields",
    dataType: "relation",
    allowMultiple: true,
    range: [fieldSystemType],
    attributes: [
      "required",
      "description",
      "default",
      "value",
      "exclude",
      "only",
    ],
  },
  immutable: {
    id: configSchemaIds.immutable,
    key: "immutable" as SystemKey,
    name: "Immutable",
    dataType: "boolean",
    description: "If true, this field cannot be modified after entity creation",
  },
  disabled: {
    id: configSchemaIds.disabled,
    key: "disabled" as SystemKey,
    name: "Disabled",
    dataType: "boolean",
    description: "Indicates if this entity is disabled",
  },
  unique: {
    id: configSchemaIds.unique,
    key: "unique" as SystemKey,
    name: "Unique",
    dataType: "boolean",
    description: "Whether the field value must be unique",
    immutable: true,
    when: { dataType: "plaintext" },
  },
  attributes: {
    id: configSchemaIds.attributes,
    key: "attributes" as SystemKey,
    name: "Attributes",
    dataType: "relation",
    description: "Allowed attribute fields for this field when used in types",
    range: [fieldSystemType],
    allowMultiple: true,
  },
  required: {
    id: configSchemaIds.required,
    key: "required" as SystemKey,
    name: "Required",
    dataType: "boolean",
    description: "Whether the field is required",
  },
  default: {
    id: configSchemaIds.default,
    key: "default" as SystemKey,
    name: "Default",
    dataType: "json",
    description: "Default value for the field",
  },
  value: {
    id: configSchemaIds.value,
    key: "value" as SystemKey,
    name: "Value",
    dataType: "plaintext",
    plaintextFormat: "line",
    description: "Fixed value constraint for the field",
  },
  exclude: {
    id: configSchemaIds.exclude,
    key: "exclude" as SystemKey,
    name: "Exclude",
    dataType: "plaintext",
    plaintextFormat: "code",
    description: "Excluded option values",
    allowMultiple: true,
  },
  only: {
    id: configSchemaIds.only,
    key: "only" as SystemKey,
    name: "Only",
    dataType: "plaintext",
    plaintextFormat: "code",
    description: "Allowed option values",
    allowMultiple: true,
  },
  when: {
    id: configSchemaIds.when,
    key: "when" as SystemKey,
    name: "When",
    dataType: "object",
    description: "Condition filters for when this field is applicable",
  },
  query: {
    id: configSchemaIds.query,
    key: "query" as SystemKey,
    name: "Query",
    dataType: "query",
    description: "Query parameters for data retrieval",
  },
  children: {
    id: configSchemaIds.children,
    key: "children" as SystemKey,
    name: "Children",
    dataType: "relation",
    description: "Child entities in hierarchical structure",
    allowMultiple: true,
  },
  parent: {
    id: configSchemaIds.parent,
    key: "parent" as SystemKey,
    name: "Parent",
    dataType: "relation",
    description: "Parent entity in hierarchical structure",
    inverseOf: "children" as SystemKey,
  },
  where: {
    id: configSchemaIds.where,
    key: "where" as SystemKey,
    name: "Where",
    dataType: "object",
    description: "Filter conditions for entity selection",
  },
  includes: {
    id: configSchemaIds.includes,
    key: "includes" as SystemKey,
    name: "Includes",
    dataType: "object",
    description: "Fields to include in entity output",
  },
  plaintextFormat: {
    id: configSchemaIds.plaintextFormat,
    key: "plaintextFormat" as SystemKey,
    name: "Plaintext Alphabet",
    dataType: "option",
    description: "Character constraints for plaintext fields",
    options: plaintextFormatOptions,
    when: { dataType: "plaintext" },
    default: "line",
  },
  richtextFormat: {
    id: configSchemaIds.richtextFormat,
    key: "richtextFormat" as SystemKey,
    name: "Richtext Alphabet",
    dataType: "option",
    description: "Formatting constraints for richtext fields",
    options: richtextFormatOptions,
    when: { dataType: "richtext" },
    default: "block",
  },
  periodFormat: {
    id: configSchemaIds.periodFormat,
    key: "periodFormat" as SystemKey,
    name: "Period Format",
    dataType: "option",
    description: "Time period granularity for period fields",
    options: periodFormatOptions,
    when: { dataType: "period" },
    default: "day",
  },
} as const satisfies Record<FieldKey, ConfigFieldDef>;
export type ConfigFieldDefinitions = typeof configFieldsDefs;
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
      "default",
      "plaintextFormat",
      "richtextFormat",
      "periodFormat",
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
> = EntityTypeBuilder<ConfigFieldDefinitions, M | CoreIdentityFieldKey, O> & {};
export type ConfigSchema = EntitySchema<ConfigDataType> & {
  fields: ConfigFieldDefinitions;
  types: ConfigTypeDefinitions;
};

export type ConfigSchemaExtended<C extends EntitySchema<ConfigDataType>> =
  ConfigSchema & C;

export const coreConfigSchema = {
  fields: configFieldsDefs,
  types: configTypeDefs,
} as const satisfies ConfigSchema;

export const validateAppConfigSchema = <D extends string>(
  schema: EntitySchema<D>,
): void => {
  for (const field of Object.values(schema.fields)) {
    validateIdInRange(field.id, APP_SYSTEM_ID_OFFSET);
  }
  for (const type of Object.values(schema.types)) {
    validateIdInRange(type.id, APP_SYSTEM_ID_OFFSET);
  }
};

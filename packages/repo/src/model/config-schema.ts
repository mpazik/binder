import type { EntityId, EntityKey } from "./entity.ts";
import {
  type CoreIdentityFieldKey,
  type EntitySchema,
  type EntityTypeBuilder,
  type FieldDef,
  fieldSystemType,
  ID_RANGE_CORE_LIMIT,
  newId,
  coreFields,
  type TypeFieldRef,
  typeSystemType,
  validateIdInRange,
} from "./schema.ts";
import { recordDataTypes, standardFields } from "./record-schema.ts";
import {
  coreDataTypes,
  type DataTypeDefs,
  dataTypeDefsToOptions,
} from "./data-type.ts";
import { periodFormatOptions } from "./period-format.ts";
import {
  DEFAULT_PLAINTEXT_FORMAT,
  DEFAULT_RICHTEXT_FORMAT,
  plaintextFormatOptions,
  richtextFormatOptions,
} from "./text-format.ts";
import type { FieldKey } from "./field.ts";
import { type ConfigId, type ConfigKey, type ConfigType } from "./config.ts";

/**
 * Config namespace field ID ranges.
 *
 * 0       16                      100
 * ├───────┼───────────────────────┼──────────►
 * │ CORE  │        META           │   APP
 * └───────┴───────────────────────┴──────────
 *
 * CORE [1-15]:  Shared across all namespaces (see schema.ts).
 * META [16-99]: Config meta-fields (Field and Type properties).
 * APP  [100+]:  Application-defined config extensions.
 */

export type ConfigSchemaId = EntityId;
export type ConfigSchemaKey = EntityKey;

export const CONFIG_META_ID_OFFSET = ID_RANGE_CORE_LIMIT;
export const CONFIG_APP_ID_OFFSET = 100;

export const newConfigMetaId = (seq: number): ConfigSchemaId =>
  newId(seq, CONFIG_META_ID_OFFSET);

export const newConfigAppId = (seq: number): ConfigSchemaId =>
  newId(seq, CONFIG_APP_ID_OFFSET);

export const configDataTypes = {
  ...coreDataTypes,
  object: { name: "Object" },
  json: { name: "JSON", description: "Any JSON value" },
  optionSet: {
    name: "Option Set",
    description: "Set of options to choose from",
  },
  query: { name: "Query", description: "Query parameters" },
} as const satisfies DataTypeDefs;
export type ConfigDataType = keyof typeof configDataTypes;

export const configSchemaIds = {
  dataType: newConfigMetaId(1),
  options: newConfigMetaId(2),
  domain: newConfigMetaId(3),
  range: newConfigMetaId(4),
  allowMultiple: newConfigMetaId(5),
  inverseOf: newConfigMetaId(6),
  fields: newConfigMetaId(7),
  immutable: newConfigMetaId(8),
  disabled: newConfigMetaId(9),
  unique: newConfigMetaId(11),
  attributes: newConfigMetaId(12),
  Field: newConfigMetaId(13),
  Type: newConfigMetaId(14),
  required: newConfigMetaId(18),
  default: newConfigMetaId(19),
  value: newConfigMetaId(20),
  exclude: newConfigMetaId(21),
  only: newConfigMetaId(22),
  when: newConfigMetaId(23),
  query: newConfigMetaId(24),
  where: newConfigMetaId(27),
  includes: newConfigMetaId(28),
  plaintextFormat: newConfigMetaId(29),
  richtextFormat: newConfigMetaId(30),
  sectionDepth: newConfigMetaId(32),
  periodFormat: newConfigMetaId(31),
} as const;
export const fieldTypes = [fieldSystemType] as const;
export type ConfigFieldDef = FieldDef<ConfigDataType>;
export const configFieldsDefs = {
  ...coreFields,
  // Structural fields shared with record namespace (used by Navigation hierarchy)
  parent: standardFields.parent,
  children: standardFields.children,
  dataType: {
    id: configSchemaIds.dataType,
    key: "dataType" as ConfigSchemaKey,
    name: "Data Type",
    dataType: "option",
    options: dataTypeDefsToOptions(recordDataTypes),
    immutable: true,
  },
  options: {
    id: configSchemaIds.options,
    key: "options" as ConfigSchemaKey,
    name: "options",
    dataType: "optionSet",
    when: { dataType: "option" },
  },
  domain: {
    id: configSchemaIds.domain,
    key: "record" as ConfigSchemaKey,
    name: "Domain",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
  },
  range: {
    id: configSchemaIds.range,
    key: "range" as ConfigSchemaKey,
    name: "range",
    dataType: "relation",
    allowMultiple: true,
    when: { dataType: "relation" },
  },
  allowMultiple: {
    id: configSchemaIds.allowMultiple,
    key: "allowMultiple" as ConfigSchemaKey,
    name: "Allow Multiple",
    dataType: "boolean",
    description: "Whether multiple values are allowed for this property",
    immutable: true,
  },
  inverseOf: {
    id: configSchemaIds.inverseOf,
    key: "inverseOf" as ConfigSchemaKey,
    name: "Inverse relation of",
    dataType: "relation",
    description: "Attribute of which this attribute is an inverse relation of",
    immutable: true,
    when: { dataType: "relation" },
  },
  fields: {
    id: configSchemaIds.fields,
    key: "fields" as ConfigSchemaKey,
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
    key: "immutable" as ConfigSchemaKey,
    name: "Immutable",
    dataType: "boolean",
    description: "If true, this field cannot be modified after entity creation",
  },
  disabled: {
    id: configSchemaIds.disabled,
    key: "disabled" as ConfigSchemaKey,
    name: "Disabled",
    dataType: "boolean",
    description: "Indicates if this entity is disabled",
  },
  unique: {
    id: configSchemaIds.unique,
    key: "unique" as ConfigSchemaKey,
    name: "Unique",
    dataType: "boolean",
    description: "Whether the field value must be unique",
    immutable: true,
    when: { dataType: "plaintext" },
  },
  attributes: {
    id: configSchemaIds.attributes,
    key: "attributes" as ConfigSchemaKey,
    name: "Attributes",
    dataType: "relation",
    description: "Allowed attribute fields for this field when used in types",
    range: [fieldSystemType],
    allowMultiple: true,
  },
  required: {
    id: configSchemaIds.required,
    key: "required" as ConfigSchemaKey,
    name: "Required",
    dataType: "boolean",
    description: "Whether the field is required",
  },
  default: {
    id: configSchemaIds.default,
    key: "default" as ConfigSchemaKey,
    name: "Default",
    dataType: "json",
    description: "Default value for the field",
  },
  value: {
    id: configSchemaIds.value,
    key: "value" as ConfigSchemaKey,
    name: "Value",
    dataType: "json",
    description: "Fixed value constraint for the field",
  },
  exclude: {
    id: configSchemaIds.exclude,
    key: "exclude" as ConfigSchemaKey,
    name: "Exclude",
    dataType: "plaintext",
    plaintextFormat: "identifier",
    description: "Excluded option values",
    allowMultiple: true,
  },
  only: {
    id: configSchemaIds.only,
    key: "only" as ConfigSchemaKey,
    name: "Only",
    dataType: "plaintext",
    plaintextFormat: "identifier",
    description: "Allowed option values",
    allowMultiple: true,
  },
  when: {
    id: configSchemaIds.when,
    key: "when" as ConfigSchemaKey,
    name: "When",
    dataType: "object",
    description: "Condition filters for when this field is applicable",
  },
  query: {
    id: configSchemaIds.query,
    key: "query" as ConfigSchemaKey,
    name: "Query",
    dataType: "query",
    description: "Query parameters for data retrieval",
  },
  where: {
    id: configSchemaIds.where,
    key: "where" as ConfigSchemaKey,
    name: "Where",
    dataType: "object",
    description: "Filter conditions for entity selection",
  },
  includes: {
    id: configSchemaIds.includes,
    key: "includes" as ConfigSchemaKey,
    name: "Includes",
    dataType: "object",
    description: "Fields to include in entity output",
  },
  plaintextFormat: {
    id: configSchemaIds.plaintextFormat,
    key: "plaintextFormat" as ConfigSchemaKey,
    name: "Plaintext Format",
    dataType: "option",
    description: "Character constraints for plaintext fields",
    options: plaintextFormatOptions,
    when: { dataType: "plaintext" },
    default: DEFAULT_PLAINTEXT_FORMAT,
  },
  richtextFormat: {
    id: configSchemaIds.richtextFormat,
    key: "richtextFormat" as ConfigSchemaKey,
    name: "Richtext Format",
    dataType: "option",
    description: "Formatting constraints for richtext fields",
    options: richtextFormatOptions,
    when: { dataType: "richtext" },
    default: DEFAULT_RICHTEXT_FORMAT,
  },
  sectionDepth: {
    id: configSchemaIds.sectionDepth,
    key: "sectionDepth" as ConfigSchemaKey,
    name: "Section Depth",
    dataType: "integer",
    description:
      "Heading level this section lives under (1–5). Content may only use deeper headings. 0 means no headings allowed.",
    when: { richtextFormat: "section" },
  },
  periodFormat: {
    id: configSchemaIds.periodFormat,
    key: "periodFormat" as ConfigSchemaKey,
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
      ["sectionDepth", { required: true }],
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
> = EntityTypeBuilder<ConfigFieldDefinitions, M | CoreIdentityFieldKey, O>;
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
    validateIdInRange(field.id, CONFIG_APP_ID_OFFSET);
  }
  for (const type of Object.values(schema.types)) {
    validateIdInRange(type.id, CONFIG_APP_ID_OFFSET);
  }
};

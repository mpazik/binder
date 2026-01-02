import {
  type ConfigDataType,
  type ConfigKey,
  type ConfigUid,
  createSchema,
  type EntitySchema,
  type FieldDef,
  fieldSystemType,
  newAppSystemId,
  type TypeDef,
  typeSystemType,
} from "@binder/db";

export const typeNavigationKey = "Navigation" as ConfigKey;
export const typeNavigationUid = "n1Vz4yDeDgH" as ConfigUid;

export const typeTemplateKey = "Template" as ConfigKey;
export const typeTemplateUid = "t3Xb6zFgGjK" as ConfigUid;

export const fieldPathKey = "path" as ConfigKey;
export const fieldPathUid = "n2Wa5zEfEhI" as ConfigUid;

export const fieldPreambleKey = "preamble" as ConfigKey;
export const fieldPreambleUid = "p4Yc7aHhIkL" as ConfigUid;

export const fieldTemplateContentKey = "templateContent" as ConfigKey;
export const fieldTemplateContentUid = "c5Zd8bIiJlM" as ConfigUid;

export const fieldTemplateKey = "template" as ConfigKey;
export const fieldTemplateUid = "r6Ae9cJjKmN" as ConfigUid;

type CliConfigFieldDef = FieldDef<ConfigDataType>;

const fieldPath: CliConfigFieldDef = {
  id: newAppSystemId(1),
  uid: fieldPathUid,
  key: fieldPathKey,
  type: fieldSystemType,
  name: "File Path",
  description: "Virtual path pattern in the navigation tree",
  dataType: "plaintext",
};

const fieldPreamble: CliConfigFieldDef = {
  id: newAppSystemId(2),
  uid: fieldPreambleUid,
  key: fieldPreambleKey,
  type: fieldSystemType,
  name: "Preamble Fields",
  description: "Fields to render in on top of the document",
  dataType: "relation",
  range: [fieldSystemType],
  allowMultiple: true,
};

const fieldTemplateContent: CliConfigFieldDef = {
  id: newAppSystemId(3),
  uid: fieldTemplateContentUid,
  key: fieldTemplateContentKey,
  type: fieldSystemType,
  name: "Template Content",
  description: "Template for rendering documents",
  dataType: "richtext",
  richtextAlphabet: "document",
};

const fieldTemplate: CliConfigFieldDef = {
  id: newAppSystemId(4),
  uid: fieldTemplateUid,
  key: fieldTemplateKey,
  type: fieldSystemType,
  name: "Template",
  description: "Reference to rendering template",
  dataType: "relation",
  range: [typeTemplateKey],
};

const typeNavigation: TypeDef = {
  id: newAppSystemId(0),
  uid: typeNavigationUid,
  key: typeNavigationKey,
  type: typeSystemType,
  name: "Navigation",
  description: "Navigation tree item for document rendering",
  fields: [
    [fieldPathKey, { required: true }],
    "query",
    "where",
    "includes",
    "children",
    "parent",
    fieldTemplateKey,
  ],
};

const typeTemplate: TypeDef = {
  id: newAppSystemId(5),
  uid: typeTemplateUid,
  key: typeTemplateKey,
  type: typeSystemType,
  name: "Template",
  description: "View template for rendering documents",
  fields: [
    "name",
    "description",
    fieldPreambleKey,
    [fieldTemplateContentKey, { required: true }],
  ],
};

export const cliConfigSchema: EntitySchema<ConfigDataType> = createSchema(
  [fieldPath, fieldTemplate, fieldTemplateContent, fieldPreamble],
  [typeNavigation, typeTemplate],
);

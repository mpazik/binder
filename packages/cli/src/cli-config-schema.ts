import {
  type ConfigDataType,
  type ConfigKey,
  type ConfigUid,
  createSchema,
  dataTypeDefsToOptions,
  type EntitySchema,
  type FieldDef,
  fieldSystemType,
  newAppSystemId,
  richtextFormats,
  type RichtextFormat,
  type TypeDef,
  typeSystemType,
} from "@binder/db";

export type TemplateFormat = Exclude<RichtextFormat, "word">;

const templateFormats = Object.fromEntries(
  Object.entries(richtextFormats).filter(([key]) => key !== "word"),
);

const templateFormatOptions = dataTypeDefsToOptions(templateFormats);

export const typeNavigationKey = "Navigation" as ConfigKey;
export const typeNavigationUid = "_1Vz4yDeDgH" as ConfigUid;

export const typeTemplateKey = "Template" as ConfigKey;
export const typeTemplateUid = "_3Xb6zFgGjK" as ConfigUid;

export const fieldPathKey = "path" as ConfigKey;
export const fieldPathUid = "_2Wa5zEfEhI" as ConfigUid;

export const fieldPreambleKey = "preamble" as ConfigKey;
export const fieldPreambleUid = "_4Yc7aHhIkL" as ConfigUid;

export const fieldTemplateContentKey = "templateContent" as ConfigKey;
export const fieldTemplateContentUid = "_5Zd8bIiJlM" as ConfigUid;

export const fieldTemplateKey = "template" as ConfigKey;
export const fieldTemplateUid = "_6Ae9cJjKmN" as ConfigUid;

export const fieldTemplateFormatKey = "templateFormat" as ConfigKey;
export const fieldTemplateFormatUid = "_7Bf0dKkLnO" as ConfigUid;

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
  richtextFormat: "document",
  allowMultiple: true,
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

const fieldTemplateFormat: CliConfigFieldDef = {
  id: newAppSystemId(6),
  uid: fieldTemplateFormatUid,
  key: fieldTemplateFormatKey,
  type: fieldSystemType,
  name: "Template Format",
  description: "Output format of the template (affects multi-value separators)",
  dataType: "option",
  options: templateFormatOptions,
  default: "block",
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
    fieldTemplateFormatKey,
  ],
};

export const cliConfigSchema: EntitySchema<ConfigDataType> = createSchema(
  [
    fieldPath,
    fieldTemplate,
    fieldTemplateContent,
    fieldPreamble,
    fieldTemplateFormat,
  ],
  [typeNavigation, typeTemplate],
);

import {
  type ConfigDataType,
  type ConfigKey,
  type ConfigSchema,
  type ConfigUid,
  coreConfigSchema,
  createSchema,
  dataTypeDefsToOptions,
  type EntitySchema,
  type FieldDef,
  fieldSystemType,
  mergeSchema,
  newConfigAppId,
  richtextFormats,
  type RichtextFormat,
  type TypeDef,
  typeSystemType,
} from "@binder/repo";

export type ViewFormat = Exclude<RichtextFormat, "word">;

const viewFormats = Object.fromEntries(
  Object.entries(richtextFormats).filter(([key]) => key !== "word"),
);

const viewFormatOptions = dataTypeDefsToOptions(viewFormats);

export const typeNavigationKey = "Navigation" as ConfigKey;
export const typeNavigationUid = "_1Vz4yDeDgH" as ConfigUid;

export const typeViewKey = "View" as ConfigKey;
export const typeViewUid = "_3Xb6zFgGjK" as ConfigUid;

export const fieldPathKey = "path" as ConfigKey;
export const fieldPathUid = "_2Wa5zEfEhI" as ConfigUid;

export const fieldPreambleKey = "preamble" as ConfigKey;
export const fieldPreambleUid = "_4Yc7aHhIkL" as ConfigUid;

export const fieldViewContentKey = "viewContent" as ConfigKey;
export const fieldViewContentUid = "_5Zd8bIiJlM" as ConfigUid;

export const typeSettingKey = "Setting" as ConfigKey;
export const typeSettingUid = "_9Dh2fMmNpQ" as ConfigUid;

export const fieldViewKey = "view" as ConfigKey;
export const fieldViewUid = "_6Ae9cJjKmN" as ConfigUid;

export const fieldLimitKey = "limit" as ConfigKey;
export const fieldLimitUid = "_8Cg1eLlMoP" as ConfigUid;

export const fieldOrderByKey = "orderBy" as ConfigKey;
export const fieldOrderByUid = "_0Ei3gNnOqR" as ConfigUid;

export const fieldViewFormatKey = "viewFormat" as ConfigKey;
export const fieldViewFormatUid = "_7Bf0dKkLnO" as ConfigUid;

type CliConfigFieldDef = FieldDef<ConfigDataType>;

const fieldPath: CliConfigFieldDef = {
  id: newConfigAppId(1),
  uid: fieldPathUid,
  key: fieldPathKey,
  type: fieldSystemType,
  name: "File Path",
  description: "Virtual path pattern in the navigation tree",
  dataType: "plaintext",
};

const fieldPreamble: CliConfigFieldDef = {
  id: newConfigAppId(2),
  uid: fieldPreambleUid,
  key: fieldPreambleKey,
  type: fieldSystemType,
  name: "Preamble Fields",
  description: "Fields to render in on top of the document",
  dataType: "relation",
  range: [fieldSystemType],
  allowMultiple: true,
};

const fieldViewContent: CliConfigFieldDef = {
  id: newConfigAppId(3),
  uid: fieldViewContentUid,
  key: fieldViewContentKey,
  type: fieldSystemType,
  name: "View Content",
  description: "View content for rendering documents",
  dataType: "richtext",
  richtextFormat: "document",
  allowMultiple: true,
};

const fieldView: CliConfigFieldDef = {
  id: newConfigAppId(4),
  uid: fieldViewUid,
  key: fieldViewKey,
  type: fieldSystemType,
  name: "View",
  description: "Reference to rendering view",
  dataType: "relation",
  range: [typeViewKey],
};

const fieldLimit: CliConfigFieldDef = {
  id: newConfigAppId(7),
  uid: fieldLimitUid,
  key: fieldLimitKey,
  type: fieldSystemType,
  name: "Limit",
  description: "Maximum number of items to return from a query",
  dataType: "integer",
};

const fieldOrderBy: CliConfigFieldDef = {
  id: newConfigAppId(9),
  uid: fieldOrderByUid,
  key: fieldOrderByKey,
  type: fieldSystemType,
  name: "Order By",
  description:
    "Field keys to order query results by; prefix with ! for descending",
  dataType: "plaintext",
  allowMultiple: true,
};

const fieldViewFormat: CliConfigFieldDef = {
  id: newConfigAppId(6),
  uid: fieldViewFormatUid,
  key: fieldViewFormatKey,
  type: fieldSystemType,
  name: "View Format",
  description: "Output format of the view (affects multi-value separators)",
  dataType: "option",
  options: viewFormatOptions,
  default: "block",
};

const typeSetting: TypeDef = {
  id: newConfigAppId(8),
  uid: typeSettingUid,
  key: typeSettingKey,
  type: typeSystemType,
  name: "Setting",
  description: "Workspace configuration setting",
  fields: ["name", "description", ["value", { required: true }]],
};

const typeNavigation: TypeDef = {
  id: newConfigAppId(0),
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
    fieldViewKey,
    fieldLimitKey,
    fieldOrderByKey,
  ],
};

const typeView: TypeDef = {
  id: newConfigAppId(5),
  uid: typeViewUid,
  key: typeViewKey,
  type: typeSystemType,
  name: "View",
  description: "View for rendering documents",
  fields: [
    "name",
    "description",
    fieldPreambleKey,
    [fieldViewContentKey, { required: true }],
    fieldViewFormatKey,
  ],
};

export const cliConfigSchema: EntitySchema<ConfigDataType> = createSchema(
  [
    fieldPath,
    fieldView,
    fieldViewContent,
    fieldPreamble,
    fieldViewFormat,
    fieldLimit,
    fieldOrderBy,
  ],
  [typeNavigation, typeView, typeSetting],
);

export const cliFullConfigSchema = mergeSchema(
  coreConfigSchema,
  cliConfigSchema,
) as ConfigSchema;

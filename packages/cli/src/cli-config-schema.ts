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

export const fieldPathKey = "path" as ConfigKey;
export const fieldPathUid = "n2Wa5zEfEhI" as ConfigUid;

type CliConfigFieldDef = FieldDef<ConfigDataType>;

const fieldPath: CliConfigFieldDef = {
  id: newAppSystemId(1),
  uid: fieldPathUid,
  key: fieldPathKey,
  type: fieldSystemType,
  name: "File Path",
  description: "Virtual path pattern in the navigation tree",
  dataType: "string",
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
  ],
};

export const cliConfigSchema: EntitySchema<ConfigDataType> = createSchema(
  [fieldPath],
  [typeNavigation],
);

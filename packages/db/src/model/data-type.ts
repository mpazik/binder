import type { IsoDate, IsoTimestamp } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import type { Filters, QueryParams } from "./query.ts";

export type DataTypeDef = {
  name: string;
  description?: string;
};
export type DataTypeDefs = Record<string, DataTypeDef>;
export const coreDataTypes = {
  seqId: { name: "Sequential Id" },
  uid: { name: "Uid" },
  relation: { name: "Relation" },
  boolean: { name: "Boolean" },
  integer: { name: "Integer" },
  decimal: { name: "Decimal" },
  string: { name: "Short text" },
  text: {
    name: "Text",
    description:
      "Single-line text with optional line breaks and inline formatting",
  },
  date: { name: "Date" },
  datetime: { name: "Date Time" },
  // formula: { name: "Formula" },
  // condition: { name: "Condition" },
  // query: { name: "Query" },
} as const satisfies DataTypeDefs;

export const dataTypeDefsToOptions = (
  dataTypeDefs: DataTypeDefs,
): OptionDef[] => {
  return Object.entries(dataTypeDefs).map(([key, value]) => ({
    key,
    name: value.name,
    description: value.description,
  }));
};
export type OptionDef = {
  key: string;
  name: string;
  description?: string;
};
export type CoreDataType = keyof typeof coreDataTypes;

export type DataTypeValueMap = {
  seqId: EntityId;
  uid: EntityUid;
  key: EntityKey;
  relation: EntityKey;
  boolean: boolean;
  integer: number;
  decimal: number;
  string: string;
  text: string;
  date: IsoDate;
  datetime: IsoTimestamp;
  interval: string;
  duration: string;
  option: string;
  uri: string;
  object: object;
  formula: object;
  condition: Filters;
  query: QueryParams;
  optionSet: OptionDef[];
};

// This will cause a compilation error if any ConfigDataType is missing from DataTypeValueMap
const _validateDataTypeMapCompleteness: {
  [K in CoreDataType]: K extends keyof DataTypeValueMap ? true : false;
} = {} as {
  [K in CoreDataType]: true;
};
void _validateDataTypeMapCompleteness; // prevent unused variable warning

// Helper types to get the value type based on dataType, with support for allowMultiple
export type GetValueType<T> = T extends {
  dataType: infer D;
  allowMultiple: true;
}
  ? D extends keyof DataTypeValueMap
    ? DataTypeValueMap[D][]
    : unknown
  : T extends { dataType: infer D }
    ? D extends keyof DataTypeValueMap
      ? DataTypeValueMap[D]
      : unknown
    : unknown;

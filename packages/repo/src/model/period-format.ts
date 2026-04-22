import { dataTypeDefsToOptions } from "./data-type.ts";
import { createPatternValidator, type TextFormatDefs } from "./text-format.ts";

export const periodFormats = {
  day: {
    name: "Day",
    description: "YYYY-MM-DD (e.g. 2024-03-25)",
    validate: createPatternValidator(
      /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
      "Invalid day format",
    ),
  },
  week: {
    name: "Week",
    description: "YYYY-W## (e.g. 2024-W12)",
    validate: createPatternValidator(
      /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
      "Invalid week format",
    ),
  },
  month: {
    name: "Month",
    description: "YYYY-MM (e.g. 2024-03)",
    validate: createPatternValidator(
      /^\d{4}-(0[1-9]|1[0-2])$/,
      "Invalid month format",
    ),
  },
  quarter: {
    name: "Quarter",
    description: "YYYY-Q# (e.g. 2024-Q1)",
    validate: createPatternValidator(
      /^\d{4}-Q[1-4]$/,
      "Invalid quarter format",
    ),
  },
  year: {
    name: "Year",
    description: "YYYY (e.g. 2024)",
    validate: createPatternValidator(/^\d{4}$/, "Invalid year format"),
  },
} as const satisfies TextFormatDefs;

export type PeriodFormat = keyof typeof periodFormats;

export const periodFormatOptions = dataTypeDefsToOptions(periodFormats);

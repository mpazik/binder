import * as YAML from "yaml";

export const serializeItemFormats = ["json", "yaml"] as const;
export type SerializeItemFormat = (typeof serializeItemFormats)[number];
export const serializeFormats = ["json", "jsonl", "yaml"] as const;
export type SerializeFormat = (typeof serializeFormats)[number];

export const serialize = <T>(
  data: T | T[],
  format: SerializeFormat,
  map?: (item: T) => unknown,
): string => {
  const mapped = map ? (Array.isArray(data) ? data.map(map) : map(data)) : data;

  if (format === "jsonl") {
    const data = Array.isArray(mapped) ? mapped : [mapped];
    return data.map((item) => JSON.stringify(item)).join("\n");
  }
  if (format === "json") return JSON.stringify(mapped, null, 2);
  return YAML.stringify(mapped);
};

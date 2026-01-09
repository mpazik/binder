import { isSeq, type YAMLSeq } from "yaml";
import type { EntitySchema, TypeDef } from "@binder/db";
import {
  findYamlContext,
  positionToOffset,
  type ParsedYaml,
  type Position,
  type YamlPath,
} from "../document/yaml-cst.ts";
import type {
  EntityMapping,
  EntityMappings,
} from "../document/entity-mapping.ts";

export type CursorEntityContext = {
  mapping: EntityMapping;
  entityIndex: number;
  typeDef?: TypeDef;
};

const findSeqIndex = (path: YamlPath, offset: number): number => {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (node && typeof node === "object" && !("key" in node) && isSeq(node)) {
      const seq = node as YAMLSeq;
      for (let j = 0; j < seq.items.length; j++) {
        const item = seq.items[j];
        if (item && typeof item === "object" && "range" in item) {
          const [start, , end] = item.range as [number, number, number];
          if (offset >= start && offset <= end) {
            return j;
          }
        }
      }
    }
  }
  return 0;
};

export const getCursorEntityContext = (
  parsed: ParsedYaml,
  entityMappings: EntityMappings,
  position: Position,
  schema: EntitySchema,
): CursorEntityContext | undefined => {
  if (entityMappings.kind === "single") {
    const mapping = entityMappings.mapping;
    const typeDef =
      mapping.status === "matched" ? schema.types[mapping.type] : undefined;
    return { mapping, entityIndex: 0, typeDef };
  }

  const offset = positionToOffset(position, parsed.lineCounter);
  const yamlContext = findYamlContext(parsed.doc.contents!, offset);

  if (entityMappings.kind === "list") {
    const entityIndex = findSeqIndex(yamlContext.path, offset);
    const mapping = entityMappings.mappings[entityIndex];
    if (!mapping) return undefined;

    const typeDef =
      mapping.status === "matched" ? schema.types[mapping.type] : undefined;
    return { mapping, entityIndex, typeDef };
  }

  const mapping = entityMappings.mapping;
  const typeDef =
    mapping.status === "matched" ? schema.types[mapping.type] : undefined;
  return { mapping, entityIndex: 0, typeDef };
};

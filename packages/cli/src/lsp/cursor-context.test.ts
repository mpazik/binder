import { describe, expect, it } from "bun:test";
import {
  mockNodeSchema,
  mockTask1Uid,
  mockTaskTypeKey,
} from "@binder/db/mocks";
import { parseYamlDocument, type Position } from "../document/yaml-cst.ts";
import { renderYamlList } from "../document/yaml.ts";
import type {
  EntityMapping,
  EntityMappings,
} from "../document/entity-mapping.ts";
import {
  getCursorEntityContext,
  type CursorEntityContext,
} from "./cursor-context.ts";

const mockMatchedMapping: EntityMapping = {
  status: "matched",
  uid: mockTask1Uid,
  type: mockTaskTypeKey,
};

const mockNewMapping: EntityMapping = {
  status: "new",
  type: mockTaskTypeKey,
};

const mockSingleMappings: EntityMappings = {
  kind: "single",
  mapping: mockMatchedMapping,
};

const mockListMappings: EntityMappings = {
  kind: "list",
  mappings: [mockMatchedMapping, mockNewMapping],
};

const mockDocumentMappings: EntityMappings = {
  kind: "document",
  mapping: mockMatchedMapping,
};

const mockNewMappings: EntityMappings = {
  kind: "single",
  mapping: mockNewMapping,
};

describe("getCursorEntityContext", () => {
  const yaml = renderYamlList([
    { title: "First Task", status: "todo" },
    { title: "Second Task", status: "done" },
  ]);
  const parsed = parseYamlDocument(yaml);

  const check = (
    entityMappings: EntityMappings,
    position: Position,
    expected: CursorEntityContext,
  ) => {
    const result = getCursorEntityContext(
      parsed,
      entityMappings,
      position,
      mockNodeSchema,
    );
    expect(result).toEqual(expected);
  };

  it("single entity returns entity at index 0", () => {
    check(
      mockSingleMappings,
      { line: 0, character: 5 },
      {
        mapping: mockMatchedMapping,
        entityIndex: 0,
        typeDef: mockNodeSchema.types[mockTaskTypeKey],
      },
    );
  });

  it("list returns first entity when cursor is on first item", () => {
    check(
      mockListMappings,
      { line: 1, character: 5 },
      {
        mapping: mockMatchedMapping,
        entityIndex: 0,
        typeDef: mockNodeSchema.types[mockTaskTypeKey],
      },
    );
  });

  it("list returns second entity when cursor is on second item", () => {
    check(
      mockListMappings,
      { line: 3, character: 5 },
      {
        mapping: mockNewMapping,
        entityIndex: 1,
        typeDef: undefined,
      },
    );
  });

  it("document returns entity at index 0", () => {
    check(
      mockDocumentMappings,
      { line: 0, character: 5 },
      {
        mapping: mockMatchedMapping,
        entityIndex: 0,
        typeDef: mockNodeSchema.types[mockTaskTypeKey],
      },
    );
  });

  it("new entity returns undefined typeDef", () => {
    check(
      mockNewMappings,
      { line: 0, character: 5 },
      {
        mapping: mockNewMapping,
        entityIndex: 0,
        typeDef: undefined,
      },
    );
  });
});

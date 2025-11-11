import { describe, expect, it } from "bun:test";
import {
  mockNodeSchema,
  mockTaskTypeKey,
  mockUserTypeKey,
  mockProjectTypeKey,
  mockWorkItemTypeKey,
  mockNotExistingNodeTypeKey,
  mockWorkItemType,
  mockTaskType,
  mockProjectType,
  mockUserType,
  mockDueDateField,
  mockTagsField,
  mockAssignedToField,
  mockTitleField,
  mockDescriptionField,
  mockStatusField,
  mockTasksField,
  mockNameField,
  mockEmailField,
} from "@binder/db/mocks";
import type {
  NodeFieldDefinition,
  NodeType,
  NodeTypeDefinition,
} from "@binder/db";
import { groupByToObject } from "@binder/utils";
import { filterSchemaByTypes } from "./schema-filter.ts";

describe("filterSchemaByTypes", () => {
  const check = (
    types: NodeType[],
    expected: { types: NodeTypeDefinition[]; fields: NodeFieldDefinition[] },
  ) => {
    const filtered = filterSchemaByTypes(mockNodeSchema, types);
    expect(filtered).toEqual({
      types: groupByToObject(expected.types, (t) => t.key),
      fields: groupByToObject(expected.fields, (t) => t.key),
    });
  };

  it("should return empty schema for empty type list", () => {
    check([], {
      types: [],
      fields: [],
    });
  });

  it("should include simple type", () => {
    check([mockUserTypeKey], {
      types: [mockUserType],
      fields: [mockNameField, mockEmailField],
    });
  });

  it("should include type with parent", () => {
    check([mockTaskTypeKey], {
      types: [mockWorkItemType, mockTaskType],
      fields: [
        mockTitleField,
        mockDescriptionField,
        mockStatusField,
        mockAssignedToField,
        mockTagsField,
        mockDueDateField,
      ],
    });
  });

  it("should include parent without children", () => {
    check([mockWorkItemTypeKey], {
      types: [mockWorkItemType],
      fields: [
        mockTitleField,
        mockDescriptionField,
        mockStatusField,
        mockAssignedToField,
        mockTagsField,
      ],
    });
  });

  it("should include multiple types with shared parent", () => {
    check([mockTaskTypeKey, mockProjectTypeKey], {
      types: [mockWorkItemType, mockTaskType, mockProjectType],
      fields: [
        mockTitleField,
        mockDescriptionField,
        mockStatusField,
        mockAssignedToField,
        mockTagsField,
        mockTasksField,
        mockDueDateField,
      ],
    });
  });

  it("should return empty schema for non-existent type", () => {
    check([mockNotExistingNodeTypeKey], {
      types: [],
      fields: [],
    });
  });

  it("should ignore non-existent types", () => {
    check([mockUserTypeKey, mockNotExistingNodeTypeKey], {
      types: [mockUserType],
      fields: [mockNameField, mockEmailField],
    });
  });
});

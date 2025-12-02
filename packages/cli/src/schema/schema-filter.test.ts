import { describe, expect, it } from "bun:test";
import {
  mockAssignedToField,
  mockCancelReasonField,
  mockCompletedAtField,
  mockDescriptionField,
  mockDueDateField,
  mockEmailField,
  mockNameField,
  mockNodeSchema,
  mockNotExistingNodeTypeKey,
  mockProjectType,
  mockProjectTypeKey,
  mockStatusField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTaskTypeKey,
  mockTitleField,
  mockUserType,
  mockUserTypeKey,
} from "@binder/db/mocks";
import type { FieldDef, NodeType, TypeDef } from "@binder/db";
import { groupByToObject } from "@binder/utils";
import { filterSchemaByTypes } from "./schema-filter.ts";

describe("filterSchemaByTypes", () => {
  const check = (
    types: NodeType[],
    expected: {
      types: TypeDef[];
      fields: FieldDef[];
    },
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

  it("should include type with all its fields", () => {
    check([mockTaskTypeKey], {
      types: [mockTaskType],
      fields: [
        mockTitleField,
        mockDescriptionField,
        mockStatusField,
        mockAssignedToField,
        mockTagsField,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
      ],
    });
  });

  it("should include multiple types with their fields", () => {
    check([mockTaskTypeKey, mockProjectTypeKey], {
      types: [mockTaskType, mockProjectType],
      fields: [
        mockTitleField,
        mockDescriptionField,
        mockStatusField,
        mockAssignedToField,
        mockTagsField,
        mockTasksField,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
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

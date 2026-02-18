import { describe, expect, it } from "bun:test";
import {
  mockAssignedToField,
  mockCancelReasonField,
  mockCompletedAtField,
  mockDueDateField,
  mockEmailField,
  mockPartnerField,
  mockRecordSchema,
  mockRelatedToField,
  mockNotExistingRecordTypeKey,
  mockPriorityField,
  mockProjectType,
  mockProjectTypeKey,
  mockStatusField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTaskTypeKey,
  mockUserType,
  mockUserTypeKey,
} from "@binder/db/mocks";
import {
  coreFields,
  type FieldDef,
  type RecordType,
  type TypeDef,
} from "@binder/db";
import { groupByToObject } from "@binder/utils";
import { filterSchemaByTypes } from "./schema-filter.ts";

describe("filterSchemaByTypes", () => {
  const check = (
    types: RecordType[],
    expected: {
      types: TypeDef[];
      fields: FieldDef[];
    },
  ) => {
    const filtered = filterSchemaByTypes(mockRecordSchema, types);
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
      fields: [coreFields.name, mockEmailField, mockPartnerField],
    });
  });

  it("should include type with all its fields", () => {
    check([mockTaskTypeKey], {
      types: [mockTaskType],
      fields: [
        coreFields.title,
        mockStatusField,
        mockPriorityField,
        mockAssignedToField,
        mockTagsField,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
        mockRelatedToField,
      ],
    });
  });

  it("should include multiple types with their fields", () => {
    check([mockTaskTypeKey, mockProjectTypeKey], {
      types: [mockTaskType, mockProjectType],
      fields: [
        coreFields.title,
        mockStatusField,
        mockPriorityField,
        mockAssignedToField,
        mockTagsField,
        mockTasksField,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
        mockRelatedToField,
      ],
    });
  });

  it("should return empty schema for non-existent type", () => {
    check([mockNotExistingRecordTypeKey], {
      types: [],
      fields: [],
    });
  });

  it("should ignore non-existent types", () => {
    check([mockUserTypeKey, mockNotExistingRecordTypeKey], {
      types: [mockUserType],
      fields: [coreFields.name, mockEmailField, mockPartnerField],
    });
  });
});

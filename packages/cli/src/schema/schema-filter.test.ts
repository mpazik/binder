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
  mockStatusFieldKey,
  mockTasksField,
  mockTaskType,
  mockTaskTypeKey,
  mockUserType,
  mockUserTypeKey,
} from "@binder/repo/mocks";
import {
  getTypeFieldKey,
  predefinedFields,
  type FieldDef,
  type RecordType,
  type TypeDef,
} from "@binder/repo";
import { groupByToObject } from "@binder/utils";
import { filterSchema, filterSchemaByTypes } from "./schema-filter.ts";

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

  it("returns empty schema for empty type list", () => {
    check([], {
      types: [],
      fields: [],
    });
  });

  it("includes simple type", () => {
    check([mockUserTypeKey], {
      types: [mockUserType],
      fields: [predefinedFields.name, mockEmailField, mockPartnerField],
    });
  });

  it("includes type with all its fields", () => {
    check([mockTaskTypeKey], {
      types: [mockTaskType],
      fields: [
        predefinedFields.title,
        mockStatusField,
        mockPriorityField,
        mockAssignedToField,
        predefinedFields.tags,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
        mockRelatedToField,
      ],
    });
  });

  it("includes multiple types with their fields", () => {
    check([mockTaskTypeKey, mockProjectTypeKey], {
      types: [mockTaskType, mockProjectType],
      fields: [
        predefinedFields.title,
        mockStatusField,
        mockPriorityField,
        mockAssignedToField,
        predefinedFields.tags,
        mockTasksField,
        mockDueDateField,
        mockCompletedAtField,
        mockCancelReasonField,
        mockRelatedToField,
      ],
    });
  });

  it("returns empty schema for non-existent type", () => {
    check([mockNotExistingRecordTypeKey], {
      types: [],
      fields: [],
    });
  });

  it("ignores non-existent types", () => {
    check([mockUserTypeKey, mockNotExistingRecordTypeKey], {
      types: [mockUserType],
      fields: [predefinedFields.name, mockEmailField, mockPartnerField],
    });
  });
});

describe("filterSchema", () => {
  it("filters by field across all matching types", () => {
    const filtered = filterSchema(mockRecordSchema, {
      fieldKeys: [mockStatusFieldKey],
    });

    const taskStatusOnly = {
      ...mockTaskType,
      fields: mockTaskType.fields.filter(
        (fieldRef) => getTypeFieldKey(fieldRef) === mockStatusFieldKey,
      ),
    };

    const projectStatusOnly = {
      ...mockProjectType,
      fields: mockProjectType.fields.filter(
        (fieldRef) => getTypeFieldKey(fieldRef) === mockStatusFieldKey,
      ),
    };

    expect(filtered).toEqual({
      types: groupByToObject([taskStatusOnly, projectStatusOnly], (t) => t.key),
      fields: groupByToObject([mockStatusField], (f) => f.key),
    });
  });

  it("filters by type and field", () => {
    const filtered = filterSchema(mockRecordSchema, {
      typeKeys: [mockTaskTypeKey],
      fieldKeys: [mockStatusFieldKey],
    });

    const taskStatusOnly = {
      ...mockTaskType,
      fields: mockTaskType.fields.filter(
        (fieldRef) => getTypeFieldKey(fieldRef) === mockStatusFieldKey,
      ),
    };

    expect(filtered).toEqual({
      types: groupByToObject([taskStatusOnly], (t) => t.key),
      fields: groupByToObject([mockStatusField], (f) => f.key),
    });
  });
});

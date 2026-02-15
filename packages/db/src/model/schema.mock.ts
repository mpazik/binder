import {
  mockAliasesField,
  mockAssignedToField,
  mockCancelReasonField,
  mockChaptersField,
  mockCompletedAtField,
  mockDueDateField,
  mockEmailField,
  mockFavoriteField,
  mockMembersField,
  mockNotesField,
  mockOwnersField,
  mockPriceField,
  mockPriorityField,
  mockProjectField,
  mockProjectType,
  mockRoleField,
  mockStatusField,
  mockStepsField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTeamType,
  mockTemplatesField,
  mockUserType,
} from "./config.mock.ts";

import { coreSchema, mergeSchema } from "./schema.ts";
import type { RecordSchema } from "./config.ts";

const mockFields = {
  [mockStatusField.key]: mockStatusField,
  [mockAssignedToField.key]: mockAssignedToField,
  [mockOwnersField.key]: mockOwnersField,
  [mockMembersField.key]: mockMembersField,
  [mockTasksField.key]: mockTasksField,
  [mockTagsField.key]: mockTagsField,
  [mockDueDateField.key]: mockDueDateField,
  [mockEmailField.key]: mockEmailField,
  [mockProjectField.key]: mockProjectField,
  [mockFavoriteField.key]: mockFavoriteField,
  [mockRoleField.key]: mockRoleField,
  [mockCompletedAtField.key]: mockCompletedAtField,
  [mockCancelReasonField.key]: mockCancelReasonField,
  [mockPriorityField.key]: mockPriorityField,
  [mockAliasesField.key]: mockAliasesField,
  [mockNotesField.key]: mockNotesField,
  [mockStepsField.key]: mockStepsField,
  [mockChaptersField.key]: mockChaptersField,
  [mockTemplatesField.key]: mockTemplatesField,
  [mockPriceField.key]: mockPriceField,
};

const mockTypes = {
  [mockTaskType.key]: mockTaskType,
  [mockProjectType.key]: mockProjectType,
  [mockUserType.key]: mockUserType,
  [mockTeamType.key]: mockTeamType,
};

// Base schema without coreFields - used for transaction mocks
export const mockRecordSchemaRaw = {
  fields: mockFields,
  types: mockTypes,
} as const satisfies RecordSchema;

// Full schema with coreFields - used for tests that need complete field lookup
export const mockRecordSchema = mergeSchema(
  coreSchema(),
  mockRecordSchemaRaw,
) as RecordSchema;

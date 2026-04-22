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
  mockPartnerField,
  mockPriceField,
  mockPriorityField,
  mockProjectField,
  mockProjectType,
  mockRelatedToField,
  mockRoleField,
  mockStatusField,
  mockStepsField,
  mockTasksField,
  mockTaskType,
  mockTeamType,
  mockViewsField,
  mockUserType,
} from "./config.mock.ts";

import { mergeSchema } from "./schema.ts";
import { coreRecordSchema } from "./record-schema.ts";
import type { RecordSchema } from "./record-schema.ts";

const mockFields = {
  [mockStatusField.key]: mockStatusField,
  [mockAssignedToField.key]: mockAssignedToField,
  [mockOwnersField.key]: mockOwnersField,
  [mockMembersField.key]: mockMembersField,
  [mockTasksField.key]: mockTasksField,
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
  [mockViewsField.key]: mockViewsField,
  [mockPriceField.key]: mockPriceField,
  [mockPartnerField.key]: mockPartnerField,
  [mockRelatedToField.key]: mockRelatedToField,
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
  coreRecordSchema(),
  mockRecordSchemaRaw,
) as RecordSchema;

import {
  mockAssignedToField,
  mockCancelReasonField,
  mockCompletedAtField,
  mockDueDateField,
  mockEmailField,
  mockFavoriteField,
  mockMembersField,
  mockOwnersField,
  mockPriorityField,
  mockProjectField,
  mockProjectType,
  mockRoleField,
  mockStatusField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTeamType,
  mockUserType,
} from "./config.mock.ts";

import type { NodeSchema } from "./config.ts";

export const mockNodeSchema = {
  fields: {
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
  },
  types: {
    [mockTaskType.key]: mockTaskType,
    [mockProjectType.key]: mockProjectType,
    [mockUserType.key]: mockUserType,
    [mockTeamType.key]: mockTeamType,
  },
} as const satisfies NodeSchema;

import {
  mockAssignedToField,
  mockDescriptionField,
  mockDueDateField,
  mockEmailField,
  mockFavoriteField,
  mockMembersField,
  mockNameField,
  mockOwnersField,
  mockProjectField,
  mockProjectType,
  mockRoleField,
  mockStatusField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTeamType,
  mockTitleField,
  mockUserType,
  mockWorkItemType,
} from "./config.mock.ts";

import type { NodeSchema } from "./node.ts";

export const mockNodeSchema = {
  fields: {
    [mockNameField.key]: mockNameField,
    [mockTitleField.key]: mockTitleField,
    [mockDescriptionField.key]: mockDescriptionField,
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
  },
  types: {
    [mockWorkItemType.key]: mockWorkItemType,
    [mockTaskType.key]: mockTaskType,
    [mockProjectType.key]: mockProjectType,
    [mockUserType.key]: mockUserType,
    [mockTeamType.key]: mockTeamType,
  },
} as const satisfies NodeSchema;

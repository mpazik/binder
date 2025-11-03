import {
  mockAssignedToField,
  mockDescriptionField,
  mockDueDateField,
  mockEmailField,
  mockMembersField,
  mockNameField,
  mockOwnersField,
  mockProjectType,
  mockStatusField,
  mockTagsField,
  mockTasksField,
  mockTaskType,
  mockTeamType,
  mockTitleField,
  mockUserType,
  mockWorkItemType,
} from "./config.mock.ts";
import type { NodeSchema } from "./schema.ts";

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
  },
  types: {
    [mockWorkItemType.key]: mockWorkItemType,
    [mockTaskType.key]: mockTaskType,
    [mockProjectType.key]: mockProjectType,
    [mockUserType.key]: mockUserType,
    [mockTeamType.key]: mockTeamType,
  },
} as const satisfies NodeSchema;

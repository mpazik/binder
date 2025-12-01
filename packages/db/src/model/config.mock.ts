import {
  type ConfigId,
  type ConfigKey,
  type ConfigUid,
  relationFieldConfigType,
  stringFieldConfigType,
} from "./config.ts";
import type { NodeFieldDef, NodeType } from "./node.ts";
import { fieldSystemType, type TypeDef, typeSystemType } from "./schema.ts";

export const mockNotExistingNodeFieldKey = "notExistingNodeField" as NodeType;
export const mockNameFieldKey = "name" as ConfigKey;
export const mockNameField = {
  id: 1 as ConfigId,
  uid: "fldName0001" as ConfigUid,
  key: mockNameFieldKey,
  type: fieldSystemType,
  name: "Name",
  description: "Name or label",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const mockTitleFieldKey = "title" as ConfigKey;
export const mockTitleField = {
  id: 2 as ConfigId,
  uid: "fldTitle002" as ConfigUid,
  key: mockTitleFieldKey,
  type: fieldSystemType,
  name: "Title",
  description: "Descriptive label",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const mockDescriptionFieldKey = "description" as ConfigKey;
export const mockDescriptionField = {
  id: 3 as ConfigId,
  uid: "fldDescrp03" as ConfigUid,
  key: mockDescriptionFieldKey,
  type: fieldSystemType,
  name: "Description",
  description: "Detailed description",
  dataType: "text",
} as const satisfies NodeFieldDef;

export const mockStatusFieldKey = "status" as ConfigKey;
export const mockStatusField = {
  id: 4 as ConfigId,
  uid: "fldStatus04" as ConfigUid,
  key: mockStatusFieldKey,
  type: fieldSystemType,
  name: "Status",
  description: "Current state",
  dataType: "option",
  options: [
    { key: "todo", name: "To Do" },
    { key: "in_progress", name: "In Progress" },
    { key: "done", name: "Done" },
    { key: "archived", name: "Archived" },
  ],
} as const satisfies NodeFieldDef;

export const mockNotExistingNodeTypeKey = "NotExistingNodeType" as NodeType;
export const mockUserTypeKey = "User" as NodeType;
export const mockTeamTypeKey = "Team" as NodeType;
export const mockProjectTypeKey = "Project" as NodeType;

export const mockAssignedToFieldKey = "assignedTo" as ConfigKey;
export const mockAssignedToField = {
  id: 5 as ConfigId,
  uid: "fldAssign05" as ConfigUid,
  key: mockAssignedToFieldKey,
  type: relationFieldConfigType,
  name: "Assigned To",
  description: "Responsible party",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
} as const satisfies NodeFieldDef;

export const mockOwnersFieldKey = "owners" as ConfigKey;
export const mockOwnersField = {
  id: 6 as ConfigId,
  uid: "fldOwners06" as ConfigUid,
  key: mockOwnersFieldKey,
  type: relationFieldConfigType,
  name: "Owners",
  description: "Multiple responsible parties",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
  allowMultiple: true,
} as const satisfies NodeFieldDef;

export const mockMembersFieldKey = "members" as ConfigKey;
export const mockMembersField = {
  id: 7 as ConfigId,
  uid: "fldMembrs07" as ConfigUid,
  key: mockMembersFieldKey,
  type: relationFieldConfigType,
  name: "Members",
  description: "Team members",
  dataType: "relation",
  range: [mockUserTypeKey],
  allowMultiple: true,
} as const satisfies NodeFieldDef;

export const mockTaskTypeKey = "Task" as NodeType;

export const mockTasksFieldKey = "tasks" as ConfigKey;
export const mockTasksField = {
  id: 8 as ConfigId,
  uid: "fldTasks008" as ConfigUid,
  key: mockTasksFieldKey,
  type: relationFieldConfigType,
  name: "Tasks",
  description: "Related tasks",
  dataType: "relation",
  range: [mockTaskTypeKey],
  allowMultiple: true,
  inverseOf: "project" as ConfigKey,
} as const satisfies NodeFieldDef;

export const mockTagsFieldKey = "tags" as ConfigKey;
export const mockTagsField = {
  id: 9 as ConfigId,
  uid: "fldTags0009" as ConfigUid,
  key: mockTagsFieldKey,
  type: stringFieldConfigType,
  name: "Tags",
  description: "Category labels",
  dataType: "string",
  allowMultiple: true,
} as const satisfies NodeFieldDef;

export const mockDueDateFieldKey = "dueDate" as ConfigKey;
export const mockDueDateField = {
  id: 10 as ConfigId,
  uid: "fldDueDat10" as ConfigUid,
  key: mockDueDateFieldKey,
  type: fieldSystemType,
  name: "Due Date",
  description: "When task is due",
  dataType: "date",
} as const satisfies NodeFieldDef;

export const mockEmailFieldKey = "email" as ConfigKey;
export const mockEmailField = {
  id: 11 as ConfigId,
  uid: "fldEmail011" as ConfigUid,
  key: mockEmailFieldKey,
  type: stringFieldConfigType,
  name: "Email",
  description: "Email address",
  dataType: "string",
  unique: true,
} as const satisfies NodeFieldDef;

export const mockProjectFieldKey = "project" as ConfigKey;
export const mockProjectField = {
  id: 12 as ConfigId,
  uid: "fldProjct12" as ConfigUid,
  key: mockProjectFieldKey,
  type: relationFieldConfigType,
  name: "Project",
  description: "Part of project",
  dataType: "relation",
  range: [mockProjectTypeKey],
} as const satisfies NodeFieldDef;

export const mockFavoriteFieldKey = "favorite" as ConfigKey;
export const mockFavoriteField = {
  id: 13 as ConfigId,
  uid: "fldFavort13" as ConfigUid,
  key: mockFavoriteFieldKey,
  type: fieldSystemType,
  name: "Favorite",
  description: "Favorite item",
  dataType: "boolean",
} as const satisfies NodeFieldDef;

export const mockWorkItemTypeKey = "WorkItem" as NodeType;
export const mockWorkItemType = {
  id: 14 as ConfigId,
  uid: "typWorkItm0" as ConfigUid,
  key: mockWorkItemTypeKey,
  type: typeSystemType,
  name: "Work Item",
  description: "Actionable item",
  fields: [
    mockTitleFieldKey,
    mockDescriptionFieldKey,
    mockStatusFieldKey,
    mockAssignedToFieldKey,
    mockTagsFieldKey,
  ],
  fields_attrs: {
    title: { required: true },
    status: { default: "todo" },
  },
} as const satisfies TypeDef;

export const mockTaskType = {
  id: 15 as ConfigId,
  uid: "typTask0012" as ConfigUid,
  key: mockTaskTypeKey,
  type: typeSystemType,
  name: "Task",
  description: "Individual unit of work",
  fields: [mockDueDateFieldKey, mockStatusFieldKey, mockAssignedToFieldKey],
  extends: mockWorkItemTypeKey,
  fields_attrs: {
    status: { exclude: ["archived"] },
    assignedTo: { only: ["User"] },
  },
} as const satisfies TypeDef;

export const mockProjectType = {
  id: 16 as ConfigId,
  uid: "typProjct13" as ConfigUid,
  key: mockProjectTypeKey,
  type: typeSystemType,
  name: "Project",
  description: "Container for related tasks",
  fields: [mockTasksFieldKey, mockStatusFieldKey],
  extends: mockWorkItemTypeKey,
  fields_attrs: {
    status: { required: true },
  },
} as const satisfies TypeDef;

export const mockUserType = {
  id: 17 as ConfigId,
  uid: "typUser0014" as ConfigUid,
  key: mockUserTypeKey,
  type: typeSystemType,
  name: "User",
  description: "Individual user account",
  fields: [mockNameFieldKey, mockEmailFieldKey],
  fields_attrs: {
    name: { required: true, description: "Full name" },
  },
} as const satisfies TypeDef;

export const mockTeamType = {
  id: 18 as ConfigId,
  uid: "typTeam0015" as ConfigUid,
  key: mockTeamTypeKey,
  type: typeSystemType,
  name: "Team",
  description: "Collaborative group",
  fields: [mockNameFieldKey, mockMembersFieldKey],
  fields_attrs: {
    name: { required: true },
    members: { min: 1 },
  },
} as const satisfies TypeDef;

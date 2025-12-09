import {
  type ConfigKey,
  type ConfigUid,
  newUserConfigId,
  type NodeFieldDef,
} from "./config.ts";
import type { NodeType } from "./node.ts";
import {
  fieldSystemType,
  titleFieldKey,
  type TypeDef,
  typeSystemType,
  nameFieldKey,
} from "./schema.ts";

export const mockNotExistingNodeFieldKey = "notExistingNodeField" as NodeType;

export const mockStatusFieldKey = "status" as ConfigKey;
export const mockStatusField = {
  id: newUserConfigId(0),
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
    { key: "cancelled", name: "Cancelled" },
    { key: "archived", name: "Archived" },
  ],
} as const satisfies NodeFieldDef;

export const mockNotExistingNodeTypeKey = "NotExistingNodeType" as NodeType;
export const mockUserTypeKey = "User" as NodeType;
export const mockTeamTypeKey = "Team" as NodeType;
export const mockProjectTypeKey = "Project" as NodeType;

export const mockAssignedToFieldKey = "assignedTo" as ConfigKey;
export const mockAssignedToField = {
  id: newUserConfigId(1),
  uid: "fldAssign05" as ConfigUid,
  key: mockAssignedToFieldKey,
  type: fieldSystemType,
  name: "Assigned To",
  description: "Responsible party",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
} as const satisfies NodeFieldDef;

export const mockRoleFieldKey = "role" as ConfigKey;
export const mockRoleField = {
  id: newUserConfigId(10),
  uid: "fldRole0014" as ConfigUid,
  key: mockRoleFieldKey,
  type: fieldSystemType,
  name: "Role",
  description: "Role in relation",
  dataType: "string",
} as const satisfies NodeFieldDef;

export const mockOwnersFieldKey = "owners" as ConfigKey;
export const mockOwnersField = {
  id: newUserConfigId(2),
  uid: "fldOwners06" as ConfigUid,
  key: mockOwnersFieldKey,
  type: fieldSystemType,
  name: "Owners",
  description: "Multiple responsible parties",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
  allowMultiple: true,
  attributes: [mockRoleFieldKey],
} as const satisfies NodeFieldDef;

export const mockMembersFieldKey = "members" as ConfigKey;
export const mockMembersField = {
  id: newUserConfigId(3),
  uid: "fldMembrs07" as ConfigUid,
  key: mockMembersFieldKey,
  type: fieldSystemType,
  name: "Members",
  description: "Team members",
  dataType: "relation",
  range: [mockUserTypeKey],
  allowMultiple: true,
} as const satisfies NodeFieldDef;

export const mockTaskTypeKey = "Task" as NodeType;

export const mockTasksFieldKey = "tasks" as ConfigKey;
export const mockTasksField = {
  id: newUserConfigId(4),
  uid: "fldTasks008" as ConfigUid,
  key: mockTasksFieldKey,
  type: fieldSystemType,
  name: "Tasks",
  description: "Related tasks",
  dataType: "relation",
  range: [mockTaskTypeKey],
  allowMultiple: true,
  inverseOf: "project" as ConfigKey,
} as const satisfies NodeFieldDef;

export const mockTagsFieldKey = "tags" as ConfigKey;
export const mockTagsField = {
  id: newUserConfigId(5),
  uid: "fldTags0009" as ConfigUid,
  key: mockTagsFieldKey,
  type: fieldSystemType,
  name: "Tags",
  description: "Category labels",
  dataType: "string",
  allowMultiple: true,
} as const satisfies NodeFieldDef;

export const mockDueDateFieldKey = "dueDate" as ConfigKey;
export const mockDueDateField = {
  id: newUserConfigId(6),
  uid: "fldDueDat10" as ConfigUid,
  key: mockDueDateFieldKey,
  type: fieldSystemType,
  name: "Due Date",
  description: "When task is due",
  dataType: "date",
} as const satisfies NodeFieldDef;

export const mockFieldKeyEmail = "email" as ConfigKey;
export const mockEmailField = {
  id: newUserConfigId(7),
  uid: "fldEmail011" as ConfigUid,
  key: mockFieldKeyEmail,
  type: fieldSystemType,
  name: "Email",
  description: "Email address",
  dataType: "string",
  unique: true,
} as const satisfies NodeFieldDef;

export const mockProjectFieldKey = "project" as ConfigKey;
export const mockProjectField = {
  id: newUserConfigId(8),
  uid: "fldProjct12" as ConfigUid,
  key: mockProjectFieldKey,
  type: fieldSystemType,
  name: "Project",
  description: "Part of project",
  dataType: "relation",
  range: [mockProjectTypeKey],
} as const satisfies NodeFieldDef;

export const mockFavoriteFieldKey = "favorite" as ConfigKey;
export const mockFavoriteField = {
  id: newUserConfigId(9),
  uid: "fldFavort14" as ConfigUid,
  key: mockFavoriteFieldKey,
  type: fieldSystemType,
  name: "Favorite",
  description: "Favorite item",
  dataType: "boolean",
} as const satisfies NodeFieldDef;

export const mockCompletedAtFieldKey = "completedAt" as ConfigKey;
export const mockCompletedAtField = {
  id: newUserConfigId(11),
  uid: "fldCompAt13" as ConfigUid,
  key: mockCompletedAtFieldKey,
  type: fieldSystemType,
  name: "Completed At",
  description: "When task was completed",
  dataType: "datetime",
  when: { status: "done" },
} as const satisfies NodeFieldDef;

export const mockCancelReasonFieldKey = "cancelReason" as ConfigKey;
export const mockCancelReasonField = {
  id: newUserConfigId(12),
  uid: "fldCancRe20" as ConfigUid,
  key: mockCancelReasonFieldKey,
  type: fieldSystemType,
  name: "Cancel Reason",
  description: "Reason for cancellation",
  dataType: "string",
  when: { status: "cancelled" },
} as const satisfies NodeFieldDef;

export const mockPriorityFieldKey = "priority" as ConfigKey;
export const mockPriorityField = {
  id: newUserConfigId(13),
  uid: "fldPriort21" as ConfigUid,
  key: mockPriorityFieldKey,
  type: fieldSystemType,
  name: "Priority",
  description: "Priority level",
  dataType: "option",
  immutable: true,
  options: [
    { key: "low", name: "Low" },
    { key: "medium", name: "Medium" },
    { key: "high", name: "High" },
  ],
} as const satisfies NodeFieldDef;

export const mockTaskType = {
  id: newUserConfigId(14),
  uid: "typTask0012" as ConfigUid,
  key: mockTaskTypeKey,
  type: typeSystemType,
  name: "Task",
  description: "Individual unit of work",
  fields: [
    [titleFieldKey, { required: true }],
    [mockStatusFieldKey, { default: "todo", exclude: ["archived"] }],
    [mockAssignedToFieldKey, { only: ["User"] }],
    mockTagsFieldKey,
    mockDueDateFieldKey,
    mockCompletedAtFieldKey,
    [mockCancelReasonFieldKey, { required: true }],
  ],
} as const satisfies TypeDef;

export const mockProjectType = {
  id: newUserConfigId(15),
  uid: "typProjct13" as ConfigUid,
  key: mockProjectTypeKey,
  type: typeSystemType,
  name: "Project",
  description: "Container for related tasks",
  fields: [
    [titleFieldKey, { required: true }],
    [mockStatusFieldKey, { default: "todo", required: true }],
    mockAssignedToFieldKey,
    mockTagsFieldKey,
    mockTasksFieldKey,
  ],
} as const satisfies TypeDef;

export const mockUserType = {
  id: newUserConfigId(16),
  uid: "typUser0014" as ConfigUid,
  key: mockUserTypeKey,
  type: typeSystemType,
  name: "User",
  description: "Individual user account",
  fields: [
    [nameFieldKey, { required: true, description: "Full name" }],
    mockFieldKeyEmail,
  ],
} as const satisfies TypeDef;

export const mockTeamType = {
  id: newUserConfigId(17),
  uid: "typTeam0015" as ConfigUid,
  key: mockTeamTypeKey,
  type: typeSystemType,
  name: "Team",
  description: "Collaborative group",
  fields: [[mockMembersFieldKey, { min: 1 }]],
} as const satisfies TypeDef;

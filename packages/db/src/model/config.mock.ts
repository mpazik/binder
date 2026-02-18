import {
  type ConfigKey,
  type ConfigUid,
  newUserConfigId,
  type RecordFieldDef,
} from "./config.ts";
import type { RecordType } from "./record.ts";
import {
  fieldSystemType,
  titleFieldKey,
  type TypeDef,
  typeSystemType,
  nameFieldKey,
} from "./schema.ts";

export const mockNotExistingRecordFieldKey =
  "notExistingRecordField" as RecordType;

export const mockStatusFieldKey = "status" as ConfigKey;
export const mockStatusField = {
  id: newUserConfigId(0),
  uid: "_fldStatus0" as ConfigUid,
  key: mockStatusFieldKey,
  type: fieldSystemType,
  name: "Status",
  description: "Current state",
  dataType: "option",
  default: "pending",
  options: [
    { key: "pending", name: "Pending" },
    { key: "active", name: "Active" },
    { key: "complete", name: "Complete" },
    { key: "cancelled", name: "Cancelled" },
    { key: "archived", name: "Archived" },
  ],
} as const satisfies RecordFieldDef;

export const mockNotExistingRecordTypeKey =
  "NotExistingRecordType" as RecordType;
export const mockUserTypeKey = "User" as RecordType;
export const mockTeamTypeKey = "Team" as RecordType;
export const mockProjectTypeKey = "Project" as RecordType;

export const mockAssignedToFieldKey = "assignedTo" as ConfigKey;
export const mockAssignedToField = {
  id: newUserConfigId(1),
  uid: "_fldAssign0" as ConfigUid,
  key: mockAssignedToFieldKey,
  type: fieldSystemType,
  name: "Assigned To",
  description: "Responsible party",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
} as const satisfies RecordFieldDef;

export const mockRoleFieldKey = "role" as ConfigKey;
export const mockRoleField = {
  id: newUserConfigId(10),
  uid: "_fldRole001" as ConfigUid,
  key: mockRoleFieldKey,
  type: fieldSystemType,
  name: "Role",
  description: "Role in relation",
  dataType: "plaintext",
  plaintextFormat: "line",
} as const satisfies RecordFieldDef;

export const mockOwnersFieldKey = "owners" as ConfigKey;
export const mockOwnersField = {
  id: newUserConfigId(2),
  uid: "_fldOwners0" as ConfigUid,
  key: mockOwnersFieldKey,
  type: fieldSystemType,
  name: "Owners",
  description: "Multiple responsible parties",
  dataType: "relation",
  range: [mockUserTypeKey, mockTeamTypeKey],
  allowMultiple: true,
  attributes: [mockRoleFieldKey],
} as const satisfies RecordFieldDef;

export const mockMembersFieldKey = "members" as ConfigKey;
export const mockMembersField = {
  id: newUserConfigId(3),
  uid: "_fldMembrs0" as ConfigUid,
  key: mockMembersFieldKey,
  type: fieldSystemType,
  name: "Members",
  description: "Team members",
  dataType: "relation",
  range: [mockUserTypeKey],
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockTaskTypeKey = "Task" as RecordType;

export const mockTasksFieldKey = "tasks" as ConfigKey;
export const mockTasksField = {
  id: newUserConfigId(4),
  uid: "_fldTasks00" as ConfigUid,
  key: mockTasksFieldKey,
  type: fieldSystemType,
  name: "Tasks",
  description: "Related tasks",
  dataType: "relation",
  range: [mockTaskTypeKey],
  allowMultiple: true,
  inverseOf: "project" as ConfigKey,
} as const satisfies RecordFieldDef;

export const mockTagsFieldKey = "tags" as ConfigKey;
export const mockTagsField = {
  id: newUserConfigId(5),
  uid: "_fldTags000" as ConfigUid,
  key: mockTagsFieldKey,
  type: fieldSystemType,
  name: "Tags",
  description: "Category labels",
  dataType: "plaintext",
  plaintextFormat: "identifier",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockDueDateFieldKey = "dueDate" as ConfigKey;
export const mockDueDateField = {
  id: newUserConfigId(6),
  uid: "_fldDueDat1" as ConfigUid,
  key: mockDueDateFieldKey,
  type: fieldSystemType,
  name: "Due Date",
  description: "When task is due",
  dataType: "date",
} as const satisfies RecordFieldDef;

export const mockFieldKeyEmail = "email" as ConfigKey;
export const mockEmailField = {
  id: newUserConfigId(7),
  uid: "_fldEmail01" as ConfigUid,
  key: mockFieldKeyEmail,
  type: fieldSystemType,
  name: "Email",
  description: "Email address",
  dataType: "plaintext",
  unique: true,
  plaintextFormat: "word",
} as const satisfies RecordFieldDef;

export const mockProjectFieldKey = "project" as ConfigKey;
export const mockProjectField = {
  id: newUserConfigId(8),
  uid: "_fldProjct1" as ConfigUid,
  key: mockProjectFieldKey,
  type: fieldSystemType,
  name: "Project",
  description: "Part of project",
  dataType: "relation",
  range: [mockProjectTypeKey],
} as const satisfies RecordFieldDef;

export const mockFavoriteFieldKey = "favorite" as ConfigKey;
export const mockFavoriteField = {
  id: newUserConfigId(9),
  uid: "_fldFavort1" as ConfigUid,
  key: mockFavoriteFieldKey,
  type: fieldSystemType,
  name: "Favorite",
  description: "Favorite item",
  dataType: "boolean",
} as const satisfies RecordFieldDef;

export const mockCompletedAtFieldKey = "completedAt" as ConfigKey;
export const mockCompletedAtField = {
  id: newUserConfigId(11),
  uid: "_fldCompAt1" as ConfigUid,
  key: mockCompletedAtFieldKey,
  type: fieldSystemType,
  name: "Completed At",
  description: "When task was completed",
  dataType: "datetime",
  when: { status: "complete" },
  default: "2024-01-01T00:00:00.000Z",
} as const satisfies RecordFieldDef;

export const mockCancelReasonFieldKey = "cancelReason" as ConfigKey;
export const mockCancelReasonField = {
  id: newUserConfigId(12),
  uid: "_fldCancRe2" as ConfigUid,
  key: mockCancelReasonFieldKey,
  type: fieldSystemType,
  name: "Cancel Reason",
  description: "Reason for cancellation",
  dataType: "plaintext",
  plaintextFormat: "line",
  when: { status: "cancelled" },
} as const satisfies RecordFieldDef;

export const mockPriorityFieldKey = "priority" as ConfigKey;
export const mockPriorityField = {
  id: newUserConfigId(13),
  uid: "_fldPriort2" as ConfigUid,
  key: mockPriorityFieldKey,
  type: fieldSystemType,
  name: "Priority",
  description: "Priority level",
  dataType: "option",
  default: "medium",
  options: [
    { key: "low", name: "Low" },
    { key: "medium", name: "Medium" },
    { key: "high", name: "High" },
  ],
} as const satisfies RecordFieldDef;

// Forward-declared keys used in type definitions below
export const mockPartnerFieldKey = "partner" as ConfigKey;
export const mockRelatedToFieldKey = "relatedTo" as ConfigKey;

export const mockTaskType = {
  id: newUserConfigId(22),
  uid: "_typTask001" as ConfigUid,
  key: mockTaskTypeKey,
  type: typeSystemType,
  name: "Task",
  description: "Individual unit of work",
  fields: [
    [titleFieldKey, { required: true }],
    [mockStatusFieldKey, { exclude: ["archived"] }],
    [mockPriorityFieldKey, {}],
    [mockAssignedToFieldKey, { only: ["User"] }],
    mockTagsFieldKey,
    mockDueDateFieldKey,
    mockCompletedAtFieldKey,
    [mockCancelReasonFieldKey, { required: true }],
    mockRelatedToFieldKey,
  ],
} as const satisfies TypeDef;

export const mockProjectType = {
  id: newUserConfigId(23),
  uid: "_typProjct1" as ConfigUid,
  key: mockProjectTypeKey,
  type: typeSystemType,
  name: "Project",
  description: "Container for related tasks",
  fields: [
    [titleFieldKey, { required: true }],
    [mockStatusFieldKey, { default: "active", required: true }],
    mockAssignedToFieldKey,
    mockTagsFieldKey,
    mockTasksFieldKey,
  ],
} as const satisfies TypeDef;

export const mockUserType = {
  id: newUserConfigId(24),
  uid: "_typUser001" as ConfigUid,
  key: mockUserTypeKey,
  type: typeSystemType,
  name: "User",
  description: "Individual user account",
  fields: [
    [nameFieldKey, { required: true, description: "Full name" }],
    mockFieldKeyEmail,
    mockPartnerFieldKey,
  ],
} as const satisfies TypeDef;

export const mockTeamType = {
  id: newUserConfigId(25),
  uid: "_typTeam001" as ConfigUid,
  key: mockTeamTypeKey,
  type: typeSystemType,
  name: "Team",
  description: "Collaborative group",
  fields: [[mockMembersFieldKey, { min: 1 }]],
} as const satisfies TypeDef;

export const mockAliasesFieldKey = "aliases" as ConfigKey;
export const mockAliasesField = {
  id: newUserConfigId(14),
  uid: "_fldAlias02" as ConfigUid,
  key: mockAliasesFieldKey,
  type: fieldSystemType,
  name: "Aliases",
  description: "Alternative names",
  dataType: "plaintext",
  plaintextFormat: "line",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockNotesFieldKey = "notes" as ConfigKey;
export const mockNotesField = {
  id: newUserConfigId(15),
  uid: "_fldNotes02" as ConfigUid,
  key: mockNotesFieldKey,
  type: fieldSystemType,
  name: "Notes",
  description: "Multiple note paragraphs",
  dataType: "plaintext",
  plaintextFormat: "paragraph",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockStepsFieldKey = "steps" as ConfigKey;
export const mockStepsField = {
  id: newUserConfigId(16),
  uid: "_fldSteps02" as ConfigUid,
  key: mockStepsFieldKey,
  type: fieldSystemType,
  name: "Steps",
  description: "Instruction steps",
  dataType: "richtext",
  richtextFormat: "block",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockChaptersFieldKey = "chapters" as ConfigKey;
export const mockChaptersField = {
  id: newUserConfigId(17),
  uid: "_fldChpts02" as ConfigUid,
  key: mockChaptersFieldKey,
  type: fieldSystemType,
  name: "Chapters",
  description: "Document chapters",
  dataType: "richtext",
  richtextFormat: "document",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockTemplatesFieldKey = "templates" as ConfigKey;
export const mockTemplatesField = {
  id: newUserConfigId(18),
  uid: "_fldTmpls02" as ConfigUid,
  key: mockTemplatesFieldKey,
  type: fieldSystemType,
  name: "Templates",
  description: "Document templates",
  dataType: "richtext",
  richtextFormat: "document",
  allowMultiple: true,
} as const satisfies RecordFieldDef;

export const mockPriceFieldKey = "price" as ConfigKey;
export const mockPriceField = {
  id: newUserConfigId(19),
  uid: "_fldPrice02" as ConfigUid,
  key: mockPriceFieldKey,
  type: fieldSystemType,
  name: "Price",
  description: "Item price",
  dataType: "decimal",
} as const satisfies RecordFieldDef;

// --- One-to-one: partner (self-referential on User) ---

export const mockPartnerField = {
  id: newUserConfigId(20),
  uid: "_fldPartnr1" as ConfigUid,
  key: mockPartnerFieldKey,
  type: fieldSystemType,
  name: "Partner",
  description: "Partner user (symmetric 1:1)",
  dataType: "relation",
  range: [mockUserTypeKey],
  inverseOf: "partner" as ConfigKey,
} as const satisfies RecordFieldDef;

// --- Many-to-many: relatedTo (self-referential on Task) ---

export const mockRelatedToField = {
  id: newUserConfigId(21),
  uid: "_fldRelTo01" as ConfigUid,
  key: mockRelatedToFieldKey,
  type: fieldSystemType,
  name: "Related To",
  description: "Related tasks (symmetric M:M)",
  dataType: "relation",
  range: [mockTaskTypeKey],
  allowMultiple: true,
  inverseOf: "relatedTo" as ConfigKey,
} as const satisfies RecordFieldDef;

import type { RecordId, RecordKey, RecordUid } from "./record.ts";
import {
  mockFieldKeyEmail,
  mockPriorityFieldKey,
  mockProjectTypeKey,
  mockTaskTypeKey,
  mockUserTypeKey,
} from "./config.mock.ts";
import type { Fieldset } from "./field.ts";

export const NONEXISTENT_NODE_UID = "_nonexisten" as RecordUid;

export const mockTask1Uid = "_taskAbc123" as RecordUid;
export const mockTask2Uid = "_taskDef456" as RecordUid;
export const mockTask3Uid = "_taskGhi789" as RecordUid;
export const mockProjectUid = "_projJkl012" as RecordUid;
export const mockUserUid = "_userRick00" as RecordUid;

export const mockTask1Key = "task-implement-user-auth" as RecordKey;
export const mockTask1Record = {
  id: 1 as RecordId,
  uid: mockTask1Uid,
  key: mockTask1Key,
  type: mockTaskTypeKey,
  title: "Implement user authentication",
  description: "Add login and registration functionality with JWT tokens",
  status: "pending",
  priority: "medium",
  tags: ["urgent", "important"],
} as const satisfies Fieldset;

export const mockTaskWithOwnersUid = "_taskOwners" as RecordUid;
export const mockTaskWithOwnersRecord = {
  id: 10 as RecordId,
  uid: mockTaskWithOwnersUid,
  type: mockTaskTypeKey,
  title: "Task with owners",
  owners: [["user-1", { role: "lead" }]],
} as const satisfies Fieldset;

export const mockTaskRecord1Updated = {
  ...mockTask1Record,
  title: "Implement user authentication system",
  tags: ["urgent", "completed", "important"],
} as const satisfies Fieldset;

export const mockProjectKey = "project-binder-system" as RecordKey;
export const mockTask2Key = "task-implement-auth" as RecordKey;
export const mockTask3Key = "task-create-api" as RecordKey;

export const mockProjectRecord = {
  id: 2 as RecordId,
  uid: mockProjectUid,
  key: mockProjectKey,
  type: mockProjectTypeKey,
  title: "Binder System",
  description: "Build a robust entity management system with REST API",
  status: "active",
} as const satisfies Fieldset;

export const mockTask2Record = {
  id: 3 as RecordId,
  uid: mockTask2Uid,
  key: mockTask2Key,
  type: mockTaskTypeKey,
  title: "Implement schema generator",
  description: "Create a dynamic schema generator",
  status: "pending",
  priority: "medium",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockTask3Record = {
  id: 4 as RecordId,
  uid: mockTask3Uid,
  key: mockTask3Key,
  type: mockTaskTypeKey,
  title: "Add relationship fields",
  description: "Enable querying related entities through API",
  status: "active",
  priority: "medium",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockUserRecord = {
  id: 5 as RecordId,
  uid: mockUserUid,
  type: mockUserTypeKey,
  name: "Rick",
  [mockFieldKeyEmail]: "rick@example.com",
} as const satisfies Fieldset;

import type { NodeId, NodeKey, NodeUid } from "./node.ts";
import {
  mockEmailFieldKey,
  mockProjectTypeKey,
  mockTaskTypeKey,
  mockUserTypeKey,
} from "./config.mock.ts";
import type { Fieldset } from "./field.ts";

export const NONEXISTENT_NODE_UID = "nonexistent" as NodeUid;

export const mockTask1Uid = "taskAbc1230" as NodeUid;
export const mockTask2Uid = "taskDef4560" as NodeUid;
export const mockTask3Uid = "taskGhi7890" as NodeUid;
export const mockProjectUid = "projJkl0120" as NodeUid;
export const mockUserUid = "userRick001" as NodeUid;

export const mockTask1Key = "task-implement-user-auth" as NodeKey;
export const mockTask1Node = {
  id: 1 as NodeId,
  uid: mockTask1Uid,
  key: mockTask1Key,
  type: mockTaskTypeKey,
  title: "Implement user authentication",
  description: "Add login and registration functionality with JWT tokens",
  status: "todo",
  tags: ["urgent", "important"],
} as const satisfies Fieldset;

export const mockTaskWithOwnersUid = "taskOwners1" as NodeUid;
export const mockTaskWithOwnersNode = {
  id: 10 as NodeId,
  uid: mockTaskWithOwnersUid,
  type: mockTaskTypeKey,
  title: "Task with owners",
  owners: [["user-1", { role: "lead" }]],
} as const satisfies Fieldset;

export const mockTaskNode1Updated = {
  ...mockTask1Node,
  title: "Implement user authentication system",
  tags: ["urgent", "completed", "important"],
} as const satisfies Fieldset;

export const mockProjectKey = "project-binder-system" as NodeKey;
export const mockTask2Key = "task-implement-auth" as NodeKey;
export const mockTask3Key = "task-create-api" as NodeKey;

export const mockProjectNode = {
  id: 2 as NodeId,
  uid: mockProjectUid,
  key: mockProjectKey,
  type: mockProjectTypeKey,
  title: "Binder System",
  description: "Build a robust entity management system with REST API",
  status: "in_progress",
} as const satisfies Fieldset;

export const mockTask2Node = {
  id: 3 as NodeId,
  uid: mockTask2Uid,
  key: mockTask2Key,
  type: mockTaskTypeKey,
  title: "Implement schema generator",
  description: "Create a dynamic schema generator",
  status: "todo",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockTask3Node = {
  id: 4 as NodeId,
  uid: mockTask3Uid,
  key: mockTask3Key,
  type: mockTaskTypeKey,
  title: "Add relationship fields",
  description: "Enable querying related entities through API",
  status: "in_progress",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockUserNode = {
  id: 5 as NodeId,
  uid: mockUserUid,
  type: mockUserTypeKey,
  name: "Rick",
  [mockEmailFieldKey]: "rick@example.com",
} as const satisfies Fieldset;

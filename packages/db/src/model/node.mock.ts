import type { NodeId, NodeKey, NodeUid } from "./node.ts";
import {
  mockFieldKeyEmail,
  mockPriorityFieldKey,
  mockProjectTypeKey,
  mockTaskTypeKey,
  mockUserTypeKey,
} from "./config.mock.ts";
import type { Fieldset } from "./field.ts";

export const NONEXISTENT_NODE_UID = "_nonexisten" as NodeUid;

export const mockTask1Uid = "_taskAbc123" as NodeUid;
export const mockTask2Uid = "_taskDef456" as NodeUid;
export const mockTask3Uid = "_taskGhi789" as NodeUid;
export const mockProjectUid = "_projJkl012" as NodeUid;
export const mockUserUid = "_userRick00" as NodeUid;

export const mockTask1Key = "task-implement-user-auth" as NodeKey;
export const mockTask1Node = {
  id: 1 as NodeId,
  uid: mockTask1Uid,
  key: mockTask1Key,
  type: mockTaskTypeKey,
  title: "Implement user authentication",
  description: "Add login and registration functionality with JWT tokens",
  status: "pending",
  priority: "medium",
  tags: ["urgent", "important"],
} as const satisfies Fieldset;

export const mockTaskWithOwnersUid = "_taskOwners" as NodeUid;
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
  status: "active",
} as const satisfies Fieldset;

export const mockTask2Node = {
  id: 3 as NodeId,
  uid: mockTask2Uid,
  key: mockTask2Key,
  type: mockTaskTypeKey,
  title: "Implement schema generator",
  description: "Create a dynamic schema generator",
  status: "pending",
  priority: "medium",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockTask3Node = {
  id: 4 as NodeId,
  uid: mockTask3Uid,
  key: mockTask3Key,
  type: mockTaskTypeKey,
  title: "Add relationship fields",
  description: "Enable querying related entities through API",
  status: "active",
  priority: "medium",
  project: mockProjectUid,
} as const satisfies Fieldset;

export const mockUserNode = {
  id: 5 as NodeId,
  uid: mockUserUid,
  type: mockUserTypeKey,
  name: "Rick",
  [mockFieldKeyEmail]: "rick@example.com",
} as const satisfies Fieldset;

import { newIsoTimestamp } from "@binder/utils";
import type { NodeId, NodeKey, NodeType, NodeUid } from "./node.ts";
import { type Fieldset } from "./entity.ts";

export const NONEXISTENT_NODE_UID = "nonexistent" as NodeUid;

const baseMockNode = {
  version: 1,
  createdAt: newIsoTimestamp("2024-01-01"),
  updatedAt: newIsoTimestamp("2024-01-01"),
} as const;

export const mockTask1Uid = "task-abc123" as NodeUid;
export const mockTask2Uid = "task-def456" as NodeUid;
export const mockTask3Uid = "task-ghi789" as NodeUid;
export const mockProjectUid = "proj-jkl012" as NodeUid;
export const mockNote1Uid = "note-mno345" as NodeUid;
export const mockNote2Uid = "note-pqr678" as NodeUid;
export const mockNote3Uid = "note-stu901" as NodeUid;

export const mockTask1Key = "task-implement-user-auth" as NodeKey;
export const mockTask1Node = {
  ...baseMockNode,
  id: 1 as NodeId,
  key: mockTask1Key,
  uid: mockTask1Uid,
  type: "Task" as NodeType,
  title: "Implement user authentication",
  description: "Add login and registration functionality with JWT tokens",
  taskStatus: "todo",
  tags: ["urgent", "important"],
} as const satisfies Fieldset;

export const mockTaskNode1Updated = {
  ...mockTask1Node,
  title: "Implement user authentication system",
  tags: ["urgent", "completed", "important"],
  version: 2,
  updatedAt: newIsoTimestamp("2024-01-02"),
} as const satisfies Fieldset;

export const mockProjectKey = "project-binder-system" as NodeKey;
export const mockTask2Key = "task-implement-auth" as NodeKey;
export const mockTask3Key = "task-create-api" as NodeKey;

export const mockProjectNode = {
  ...baseMockNode,
  id: 2 as NodeId,
  key: mockProjectKey,
  uid: mockProjectUid,
  type: "Project" as NodeType,
  title: "Binder System",
  description: "Build a robust entity management system with REST API",
  projectStatus: "in_progress",
  projectTasks: [mockTask2Uid, mockTask3Uid],
} as const satisfies Fieldset;

export const mockTask2Node = {
  ...baseMockNode,
  id: 3 as NodeId,
  key: mockTask2Key,
  uid: mockTask2Uid,
  type: "Task" as NodeType,
  title: "Implement schema generator",
  description: "Create a dynamic schema generator",
  taskStatus: "todo",
  partOfProject: mockProjectNode.uid,
} as const satisfies Fieldset;

export const mockTask3Node = {
  ...baseMockNode,
  id: 4 as NodeId,
  key: mockTask3Key,
  uid: mockTask3Uid,
  type: "Task" as NodeType,
  title: "Add relationship fields",
  description: "Enable querying related entities through API",
  taskStatus: "in_progress",
  partOfProject: mockProjectNode.uid,
  createdAt: newIsoTimestamp("2024-01-15"),
  updatedAt: newIsoTimestamp("2024-01-15"),
} as const satisfies Fieldset;

export const mockNote1Key = "note-project-planning" as NodeKey;
export const mockNote2Key = "note-api-design" as NodeKey;
export const mockNote3Key = "note-testing-strategy" as NodeKey;

export const mockNote1Node = {
  ...baseMockNode,
  id: 5 as NodeId,
  key: mockNote1Key,
  uid: mockNote1Uid,
  type: "Note" as NodeType,
  title: "Project Planning Notes",
  description: "Initial thoughts and planning for the project",
  content:
    "We need to focus on building a robust knowledge graph with proper relationships and validation.\n\nBesides it is very important to make the system performant.",
  partOfProject: mockProjectNode.uid,
} as const satisfies Fieldset;

export const mockNote2Node = {
  ...baseMockNode,
  id: 6 as NodeId,
  key: mockNote2Key,
  uid: mockNote2Uid,
  type: "Note" as NodeType,
  title: "API Design Considerations",
  description: "Notes about REST API design patterns",
  content:
    "Consider using JSON-RPC for better type safety and tooling support. REST endpoints should be simple and intuitive.",
} as const satisfies Fieldset;

export const mockNote3Node = {
  ...baseMockNode,
  id: 7 as NodeId,
  key: mockNote3Key,
  uid: mockNote3Uid,
  type: "Note" as NodeType,
  title: "Testing Strategy",
  description: "Comprehensive testing approach for the system",
  content:
    "Unit tests for business logic, integration tests for API endpoints, and end-to-end tests for user workflows.",
  partOfProject: mockProjectNode.uid,
} as const satisfies Fieldset;

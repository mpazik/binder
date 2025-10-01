import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
  mockTask2Node,
} from "./node.mock.ts";
import { changesetForNewEntity } from "./changeset.ts";
import type {
  FieldChangeset,
  ValueChange,
  EntityChangesetInput,
} from "./changeset.ts";

export const mockChangesetCreateTask1 = changesetForNewEntity(mockTask1Node);
export const mockChangesetUpdateTask1 = {
  title: {
    op: "set",
    previous: mockTask1Node.title,
    value: mockTaskNode1Updated.title,
  },
  tags: {
    op: "sequence",
    mutations: [{ kind: "insert", value: "completed", position: 1 }],
  },
  version: {
    op: "set",
    previous: mockTask1Node.version,
    value: mockTaskNode1Updated.version,
  },
  updatedAt: {
    op: "set",
    previous: mockTask1Node.updatedAt,
    value: mockTaskNode1Updated.updatedAt,
  },
} as const satisfies FieldChangeset;

export const mockRemoveChange = {
  op: "sequence",
  mutations: [{ kind: "remove", removed: "completed", position: 1 }],
} as const satisfies ValueChange;

export const mockChangesetInvert = {
  title: {
    op: "set",
    previous: mockTaskNode1Updated.title,
    value: mockTask1Node.title,
  },
  tags: mockRemoveChange,
  version: {
    op: "set",
    previous: mockTaskNode1Updated.version,
    value: mockTask1Node.version,
  },
  updatedAt: {
    op: "set",
    previous: mockTaskNode1Updated.updatedAt,
    value: mockTask1Node.updatedAt,
  },
} as const satisfies FieldChangeset;

export const mockChangesetInputCreateTask1: EntityChangesetInput<"node"> = {
  uid: mockTask1Uid,
  type: mockTask1Node.type,
  key: mockTask1Node.key,
  title: mockTask1Node.title,
  description: mockTask1Node.description,
  taskStatus: mockTask1Node.taskStatus,
  tags: mockTask1Node.tags,
};

export const mockChangesetInputUpdateTask1: EntityChangesetInput<"node"> = {
  $ref: mockTask1Uid,
  title: mockTaskNode1Updated.title,
  tags: [{ kind: "insert", value: "completed", position: 1 }],
};

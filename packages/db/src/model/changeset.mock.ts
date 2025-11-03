import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
} from "./node.mock.ts";
import type {
  EntityChangesetInput,
  FieldChangeset,
  ValueChange,
} from "./changeset.ts";

export const mockChangesetCreateTask1 = mockTask1Node;
export const mockChangesetUpdateTask1 = {
  title: {
    op: "set",
    previous: mockTask1Node.title,
    value: mockTaskNode1Updated.title,
  },
  tags: {
    op: "seq",
    mutations: [["insert", "completed", 1]],
  },
} as const satisfies FieldChangeset;

export const mockRemoveChange = {
  op: "seq",
  mutations: [["remove", "completed", 1]],
} as const satisfies ValueChange;

export const mockChangesetInvert = {
  title: {
    op: "set",
    previous: mockTaskNode1Updated.title,
    value: mockTask1Node.title,
  },
  tags: mockRemoveChange,
} as const satisfies FieldChangeset;

export const mockChangesetInputCreateTask1: EntityChangesetInput<"node"> = {
  uid: mockTask1Uid,
  type: mockTask1Node.type,
  key: mockTask1Node.key,
  title: mockTask1Node.title,
  description: mockTask1Node.description,
  status: mockTask1Node.status,
  tags: mockTask1Node.tags,
};

export const mockChangesetInputUpdateTask1: EntityChangesetInput<"node"> = {
  $ref: mockTask1Uid,
  title: mockTaskNode1Updated.title,
  tags: [["insert", "completed", 1]],
};

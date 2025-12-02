import type { EntityChangesetInput } from "./changeset-input.ts";
import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
} from "./node.mock.ts";

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

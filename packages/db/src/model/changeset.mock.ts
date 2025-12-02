import { mockTask1Node, mockTaskNode1Updated } from "./node.mock.ts";
import type {
  FieldChangeset,
  ValueChangeSeq,
  ValueChangeSet,
} from "./changeset.ts";

export const mockChangesetCreateTask1 = mockTask1Node;

export const mockTitleSetChange = [
  "set",
  mockTaskNode1Updated.title,
  mockTask1Node.title,
] as const satisfies ValueChangeSet;

export const mockChangesetUpdateTask1 = {
  title: mockTitleSetChange,
  tags: ["seq", [["insert", "completed", 1]]],
} as const satisfies FieldChangeset;

export const mockRemoveChange = [
  "seq",
  [["remove", "completed", 1]],
] as const satisfies ValueChangeSeq;

export const mockChangesetInvert = {
  title: ["set", mockTask1Node.title, mockTaskNode1Updated.title],
  tags: mockRemoveChange,
} as const satisfies FieldChangeset;

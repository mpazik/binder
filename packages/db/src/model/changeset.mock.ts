import { mockTask1Record, mockTaskRecord1Updated } from "./record.mock.ts";
import type {
  FieldChangeset,
  ValueChangeSeq,
  ValueChangeSet,
} from "./changeset.ts";

export const mockChangesetCreateTask1 = mockTask1Record;

export const mockTitleSetChange = [
  "set",
  mockTaskRecord1Updated.title,
  mockTask1Record.title,
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
  title: ["set", mockTask1Record.title, mockTaskRecord1Updated.title],
  tags: mockRemoveChange,
} as const satisfies FieldChangeset;

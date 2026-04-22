import { mockTask1Record, mockTaskRecord1Updated } from "./record.mock.ts";
import type {
  FieldChangeset,
  ValueChangeDiff,
  ValueChangeSeq,
  ValueChangeSet,
} from "./changeset.ts";
import { computeTextDiff, inverseTextDiff } from "./text-diff.ts";

export const mockChangesetCreateTask1 = mockTask1Record;

export const mockTitleSetChange = [
  "set",
  mockTaskRecord1Updated.title,
  mockTask1Record.title,
] as const satisfies ValueChangeSet;

/**
 * Canonical diff ops transforming `mockTask1Record.description` into
 * `mockTaskRecord1Updated.description`. Computed at module load so the ops
 * stay in sync if the record mocks are ever edited.
 */
const descriptionDiffOps = computeTextDiff(
  mockTask1Record.description,
  mockTaskRecord1Updated.description,
);

export const mockDescriptionDiffChange: ValueChangeDiff = [
  "diff",
  descriptionDiffOps,
];

export const mockDescriptionDiffInverseChange: ValueChangeDiff = [
  "diff",
  inverseTextDiff(descriptionDiffOps),
];

export const mockChangesetUpdateTask1: FieldChangeset = {
  title: mockTitleSetChange,
  description: mockDescriptionDiffChange,
  tags: ["seq", [["insert", "completed", 1]]],
};

export const mockRemoveChange = [
  "seq",
  [["remove", "completed", 1]],
] as const satisfies ValueChangeSeq;

export const mockChangesetInvert: FieldChangeset = {
  title: ["set", mockTask1Record.title, mockTaskRecord1Updated.title],
  description: mockDescriptionDiffInverseChange,
  tags: mockRemoveChange,
};

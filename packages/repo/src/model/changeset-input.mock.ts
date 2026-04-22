import type { EntityChangesetInput } from "./changeset-input.ts";
import {
  mockTask1Record,
  mockTask1Uid,
  mockTaskRecord1Updated,
} from "./record.mock.ts";
import { computeTextDiff } from "./text-diff.ts";

export const mockChangesetInputCreateTask1: EntityChangesetInput<"record"> = {
  uid: mockTask1Uid,
  type: mockTask1Record.type,
  key: mockTask1Record.key,
  title: mockTask1Record.title,
  description: mockTask1Record.description,
  status: mockTask1Record.status,
  tags: mockTask1Record.tags,
};

export const mockChangesetInputUpdateTask1: EntityChangesetInput<"record"> = {
  uid: mockTask1Uid,
  title: mockTaskRecord1Updated.title,
  description: [
    "diff",
    computeTextDiff(
      mockTask1Record.description,
      mockTaskRecord1Updated.description,
    ),
  ],
  tags: [["insert", "completed", 1]],
};

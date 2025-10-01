import { describe, expect, test } from "bun:test";
import {
  mockChangesetUpdateTask1,
  mockChangesetInvert,
  mockRemoveChange,
} from "./changeset.mock.ts";
import squashChangesets, {
  applyChange,
  applyChangeset,
  emptyChangeset,
  type FieldChangeset,
  inverseChange,
  inverseChangeset,
  rebaseChangeset,
} from "./changeset.ts";
import { mockTaskNode1Updated, mockTask1Node } from "./node.mock.ts";

describe("inverse", () => {
  test("inverts set change", () => {
    const result = inverseChange(mockChangesetUpdateTask1.title);

    expect(result).toEqual({
      op: "set",
      value: mockTask1Node.title,
      previous: mockTaskNode1Updated.title,
    });
  });

  test("inverts remove change to add", () => {
    const result = inverseChange(mockRemoveChange);

    expect(result).toEqual(mockChangesetUpdateTask1.tags);
  });

  test("inverts all attribute changes", () => {
    const result = inverseChangeset(mockChangesetUpdateTask1);

    expect(result).toEqual(mockChangesetInvert);
  });

  test("double inversion returns original changeset", () => {
    const result = inverseChangeset(inverseChangeset(mockChangesetUpdateTask1));

    expect(result).toEqual(mockChangesetUpdateTask1);
  });
});

describe("apply", () => {
  test("applies set change", () => {
    const result = applyChange(
      mockTask1Node.title,
      mockChangesetUpdateTask1.title,
    );

    expect(result).toBe(mockTaskNode1Updated.title);
  });

  test("applies remove change", () => {
    const result = applyChange(mockTaskNode1Updated.tags, mockRemoveChange);

    expect(result).toEqual(mockTask1Node.tags);
  });

  test("applies mixed changeset", () => {
    const result = applyChangeset(mockTask1Node, mockChangesetUpdateTask1);

    expect(result).toEqual(mockTaskNode1Updated);
  });

  test("applies empty changeset", () => {
    const result = applyChangeset(mockTask1Node, emptyChangeset);

    expect(result).toEqual(mockTask1Node);
  });

  test("throws when remove mutation targets missing value", () => {
    expect(() =>
      applyChange(mockTask1Node.tags, {
        op: "sequence",
        mutations: [{ kind: "remove", removed: "completed", position: 1 }],
      }),
    ).toThrowError();
  });
});

const finalTitle = "Final";
const baseTitleChangeset: FieldChangeset = {
  title: mockChangesetUpdateTask1.title,
};
const baseSeqAddChangeset: FieldChangeset = {
  tags: mockChangesetUpdateTask1.tags,
};
const baseSeqRemoveChangeset: FieldChangeset = { tags: mockRemoveChange };
const secondTitleChangeset: FieldChangeset = {
  title: {
    op: "set",
    previous: mockTaskNode1Updated.title,
    value: finalTitle,
  },
};

describe("rebase", () => {
  test("keeps changes when base does not touch attribute", () => {
    const changeset: FieldChangeset = {
      tags: mockChangesetUpdateTask1.tags,
    };

    expect(rebaseChangeset(baseTitleChangeset, changeset)).toEqual(changeset);
  });

  test("rebases set change sharing the same ancestor", () => {
    const changeset: FieldChangeset = {
      title: {
        ...mockChangesetUpdateTask1.title,
        value: finalTitle,
      },
    };

    expect(rebaseChangeset(baseTitleChangeset, changeset)).toEqual(
      secondTitleChangeset,
    );
  });

  test("throws when rebasing a conflicting set change", () => {
    const changeset: FieldChangeset = {
      title: {
        op: "set",
        previous: "Other",
        value: finalTitle,
      },
    };

    expect(() => rebaseChangeset(baseTitleChangeset, changeset)).toThrowError(
      /Cannot rebase set change/,
    );
  });

  test("adjusts positions when rebasing add operations", () => {
    const changeset: FieldChangeset = {
      tags: {
        op: "sequence",
        mutations: [{ kind: "insert", value: "beta", position: 3 }],
      },
    };

    expect(rebaseChangeset(baseSeqAddChangeset, changeset)).toEqual({
      tags: {
        op: "sequence",
        mutations: [{ kind: "insert", value: "beta", position: 4 }],
      },
    });
  });

  test("adjusts positions when rebasing remove operations", () => {
    const changeset: FieldChangeset = {
      tags: {
        op: "sequence",
        mutations: [{ kind: "remove", removed: "gamma", position: 3 }],
      },
    };

    expect(rebaseChangeset(baseSeqRemoveChangeset, changeset)).toEqual({
      tags: {
        op: "sequence",
        mutations: [{ kind: "remove", removed: "gamma", position: 2 }],
      },
    });
  });

  test("throws when rebasing remove operations targeting the same element", () => {
    const conflictingRemoval: FieldChangeset = {
      tags: {
        op: "sequence",
        mutations: [{ kind: "remove", removed: "completed", position: 1 }],
      },
    };

    expect(() =>
      rebaseChangeset(baseSeqRemoveChangeset, conflictingRemoval),
    ).toThrowError();
  });
});

describe("squash", () => {
  test("squashes non-conflicting changesets", () => {
    expect(squashChangesets(baseTitleChangeset, baseSeqAddChangeset)).toEqual({
      ...baseTitleChangeset,
      ...baseSeqAddChangeset,
    });
  });

  test("squashes set changes on same attribute", () => {
    expect(squashChangesets(baseTitleChangeset, secondTitleChangeset)).toEqual({
      title: {
        op: "set",
        previous: mockTask1Node.title,
        value: finalTitle,
      },
    });
  });

  test("squashes sequence operations", () => {
    const anotherSeqAddChange: FieldChangeset = {
      tags: {
        op: "sequence",
        mutations: [{ kind: "insert", value: "beta", position: 1 }],
      },
    };

    expect(squashChangesets(baseSeqAddChangeset, anotherSeqAddChange)).toEqual({
      tags: {
        op: "sequence",
        mutations: [
          { kind: "insert", value: "completed", position: 1 },
          { kind: "insert", value: "beta", position: 2 },
        ],
      },
    });
  });

  test("cancels out add followed by remove", () => {
    const seqRemoveChange: FieldChangeset = { tags: mockRemoveChange };

    expect(squashChangesets(baseSeqAddChangeset, seqRemoveChange)).toEqual(
      emptyChangeset,
    );
  });

  test("squashing preserves application order", () => {
    const squashed = squashChangesets(baseTitleChangeset, secondTitleChangeset);

    const sequential = applyChangeset(
      applyChangeset(mockTask1Node, baseTitleChangeset),
      secondTitleChangeset,
    );
    const direct = applyChangeset(mockTask1Node, squashed);

    expect(sequential).toEqual(direct);
  });

  test("squash of changeset and its inverse is empty", () => {
    const inverse = inverseChangeset(mockChangesetUpdateTask1);

    expect(squashChangesets(mockChangesetUpdateTask1, inverse)).toEqual(
      emptyChangeset,
    );
  });

  test("squashing repeated removals matches sequential application", () => {
    const repeatedRemoval: FieldChangeset = {
      tags: {
        op: "sequence",
        mutations: [{ kind: "remove", removed: "important", position: 1 }],
      },
    };

    const squashed = squashChangesets(baseSeqRemoveChangeset, repeatedRemoval);

    const sequential = applyChangeset(
      applyChangeset(mockTaskNode1Updated, baseSeqRemoveChangeset),
      repeatedRemoval,
    );
    const direct = applyChangeset(mockTaskNode1Updated, squashed);

    expect(direct).toEqual(sequential);
  });
});

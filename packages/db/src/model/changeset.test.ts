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
  normalizeValueChange,
  rebaseChangeset,
  type ValueChange,
} from "./changeset.ts";
import { mockTaskNode1Updated, mockTask1Node } from "./node.mock.ts";

describe("normalize", () => {
  test("normalizes string FieldValue to ValueChange with op:set", () => {
    const result = normalizeValueChange("hello");
    expect(result).toEqual({
      op: "set",
      value: "hello",
      previous: undefined,
    });
  });

  test("normalizes number FieldValue to ValueChange with op:set", () => {
    const result = normalizeValueChange(42);
    expect(result).toEqual({
      op: "set",
      value: 42,
      previous: undefined,
    });
  });

  test("normalizes null FieldValue to ValueChange with op:set", () => {
    const result = normalizeValueChange(null);
    expect(result).toEqual({
      op: "set",
      value: null,
      previous: undefined,
    });
  });

  test("normalizes array FieldValue to ValueChange with op:set", () => {
    const result = normalizeValueChange([1, 2, 3]);
    expect(result).toEqual({
      op: "set",
      value: [1, 2, 3],
      previous: undefined,
    });
  });

  test("passes through ValueChange with op:set unchanged", () => {
    const valueChange: ValueChange = {
      op: "set",
      value: "world",
      previous: "hello",
    };
    const result = normalizeValueChange(valueChange);
    expect(result).toEqual(valueChange);
  });

  test("passes through ValueChange with op:seq unchanged", () => {
    const valueChange: ValueChange = {
      op: "seq",
      mutations: [["insert", "item", 0]],
    };
    const result = normalizeValueChange(valueChange);
    expect(result).toEqual(valueChange);
  });
});

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
        op: "seq",
        mutations: [["remove", "completed", 1]],
      }),
    ).toThrowError();
  });

  test("applies insert with undefined position (append)", () => {
    const result = applyChange(["a", "b", "c"], {
      op: "seq",
      mutations: [["insert", "d"]],
    });

    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  test("applies remove with undefined position (remove last)", () => {
    const result = applyChange(["a", "b", "c"], {
      op: "seq",
      mutations: [["remove", "c"]],
    });

    expect(result).toEqual(["a", "b"]);
  });

  test("applies multiple appends in sequence", () => {
    const result = applyChange(["a"], {
      op: "seq",
      mutations: [
        ["insert", "b"],
        ["insert", "c"],
      ],
    });

    expect(result).toEqual(["a", "b", "c"]);
  });

  test("throws when remove-last targets wrong value", () => {
    expect(() =>
      applyChange(["a", "b", "c"], {
        op: "seq",
        mutations: [["remove", "wrong"]],
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
        op: "seq",
        mutations: [["insert", "beta", 3]],
      },
    };

    expect(rebaseChangeset(baseSeqAddChangeset, changeset)).toEqual({
      tags: {
        op: "seq",
        mutations: [["insert", "beta", 4]],
      },
    });
  });

  test("adjusts positions when rebasing remove operations", () => {
    const changeset: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["remove", "gamma", 3]],
      },
    };

    expect(rebaseChangeset(baseSeqRemoveChangeset, changeset)).toEqual({
      tags: {
        op: "seq",
        mutations: [["remove", "gamma", 2]],
      },
    });
  });

  test("throws when rebasing remove operations targeting the same element", () => {
    const conflictingRemoval: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["remove", "completed", 1]],
      },
    };

    expect(() =>
      rebaseChangeset(baseSeqRemoveChangeset, conflictingRemoval),
    ).toThrowError();
  });

  test("keeps undefined position when rebasing append", () => {
    const changeset: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "new"]],
      },
    };

    expect(rebaseChangeset(baseSeqAddChangeset, changeset)).toEqual({
      tags: {
        op: "seq",
        mutations: [["insert", "new", undefined]],
      },
    });
  });

  test("keeps undefined position when rebasing remove-last", () => {
    const changeset: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["remove", "last"]],
      },
    };

    expect(rebaseChangeset(baseSeqAddChangeset, changeset)).toEqual({
      tags: {
        op: "seq",
        mutations: [["remove", "last", undefined]],
      },
    });
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
        op: "seq",
        mutations: [["insert", "beta", 1]],
      },
    };

    expect(squashChangesets(baseSeqAddChangeset, anotherSeqAddChange)).toEqual({
      tags: {
        op: "seq",
        mutations: [
          ["insert", "completed", 1],
          ["insert", "beta", 2],
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

  test("squashes set followed by seq operations", () => {
    const setChangeset: FieldChangeset = {
      tags: {
        op: "set",
        value: ["a", "b"],
        previous: undefined,
      },
    };

    const seqChangeset: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "c", 2]],
      },
    };

    expect(squashChangesets(setChangeset, seqChangeset)).toEqual({
      tags: {
        op: "set",
        value: ["a", "b", "c"],
        previous: undefined,
      },
    });
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
        op: "seq",
        mutations: [["remove", "important", 1]],
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

  test("squashes append followed by remove-last", () => {
    const appendChange: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "new"]],
      },
    };
    const removeLastChange: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["remove", "new"]],
      },
    };

    expect(squashChangesets(appendChange, removeLastChange)).toEqual(
      emptyChangeset,
    );
  });

  test("squashes multiple appends", () => {
    const firstAppend: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "first"]],
      },
    };
    const secondAppend: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "second"]],
      },
    };

    expect(squashChangesets(firstAppend, secondAppend)).toEqual({
      tags: {
        op: "seq",
        mutations: [
          ["insert", "first", undefined],
          ["insert", "second", undefined],
        ],
      },
    });
  });

  test("squashing with appends matches sequential application", () => {
    const appendChange: FieldChangeset = {
      tags: {
        op: "seq",
        mutations: [["insert", "new"]],
      },
    };

    const squashed = squashChangesets(baseSeqAddChangeset, appendChange);

    const sequential = applyChangeset(
      applyChangeset(mockTask1Node, baseSeqAddChangeset),
      appendChange,
    );
    const direct = applyChangeset(mockTask1Node, squashed);

    expect(direct).toEqual(sequential);
  });
});

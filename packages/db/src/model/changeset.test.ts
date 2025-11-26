import { describe, expect, test } from "bun:test";
import { omit } from "@binder/utils";
import {
  mockChangesetCreateTask1,
  mockChangesetInvert,
  mockChangesetUpdateTask1,
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
import { mockTask1Node, mockTaskNode1Updated } from "./node.mock.ts";
import type { Fieldset, FieldValue } from "./field.ts";

describe("normalize", () => {
  const checkNormalized = (
    input: ValueChange | FieldValue,
    expected: ValueChange,
  ) => {
    const result = normalizeValueChange(input);
    expect(result).toEqual(expected);
  };

  test("normalizes string FieldValue to ValueChange with op:set", () =>
    checkNormalized("hello", {
      op: "set",
      value: "hello",
      previous: undefined,
    }));

  test("normalizes number FieldValue to ValueChange with op:set", () =>
    checkNormalized(42, {
      op: "set",
      value: 42,
      previous: undefined,
    }));

  test("normalizes null FieldValue to ValueChange with op:set", () =>
    checkNormalized(null, {
      op: "set",
      value: null,
      previous: undefined,
    }));

  test("normalizes array FieldValue to ValueChange with op:set", () =>
    checkNormalized([1, 2, 3], {
      op: "set",
      value: [1, 2, 3],
      previous: undefined,
    }));

  test("passes through ValueChange with op:set unchanged", () => {
    const valueChange: ValueChange = {
      op: "set",
      value: "world",
      previous: "hello",
    };
    checkNormalized(valueChange, valueChange);
  });

  test("passes through ValueChange with op:seq unchanged", () => {
    const valueChange: ValueChange = {
      op: "seq",
      mutations: [["insert", "item", 0]],
    };
    checkNormalized(valueChange, valueChange);
  });
});

describe("inverseChange", () => {
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

  test("applying change then its inverse returns original value", () => {
    expect(
      applyChange(
        mockTaskNode1Updated.title,
        inverseChange(mockChangesetUpdateTask1.title),
      ),
    ).toEqual(mockTask1Node.title);
  });

  test("applying change then its inverse removes field", () => {
    expect(
      applyChange(
        mockTask1Node.title,
        inverseChange(normalizeValueChange(mockChangesetCreateTask1.title)),
      ),
    ).toEqual(null);
  });
});

describe("inverseChangeset", () => {
  test("inverts all attribute changes", () => {
    const result = inverseChangeset(mockChangesetUpdateTask1);
    expect(result).toEqual(mockChangesetInvert);
  });

  test("double inversion returns original changeset", () => {
    const result = inverseChangeset(inverseChangeset(mockChangesetUpdateTask1));
    expect(result).toEqual(mockChangesetUpdateTask1);
  });
});

describe("applyChange", () => {
  const checkApply = (
    entity: FieldValue,
    input: ValueChange,
    expected: FieldValue,
  ) => {
    const result = applyChange(entity, input);
    expect(result).toEqual(expected);
  };

  test("applies set change", () => {
    checkApply(
      mockTask1Node.title,
      mockChangesetUpdateTask1.title,
      mockTaskNode1Updated.title,
    );
  });

  test("applies remove change", () => {
    checkApply(mockTaskNode1Updated.tags, mockRemoveChange, mockTask1Node.tags);
  });

  test("throws when remove mutation targets missing value", () => {
    expect(() =>
      applyChange(mockTask1Node.tags, {
        op: "seq",
        mutations: [["remove", "completed", 1]],
      }),
    ).toThrowError();
  });

  test("applies insert with undefined position (append)", () =>
    checkApply(
      ["a", "b", "c"],
      {
        op: "seq",
        mutations: [["insert", "d"]],
      },
      ["a", "b", "c", "d"],
    ));

  test("applies remove with undefined position (remove last)", () =>
    checkApply(
      ["a", "b", "c"],
      {
        op: "seq",
        mutations: [["remove", "c"]],
      },
      ["a", "b"],
    ));

  test("applies multiple appends in sequence", () =>
    checkApply(
      ["a"],
      {
        op: "seq",
        mutations: [
          ["insert", "b"],
          ["insert", "c"],
        ],
      },
      ["a", "b", "c"],
    ));

  test("throws when remove-last targets wrong value", () => {
    expect(() =>
      applyChange(["a", "b", "c"], {
        op: "seq",
        mutations: [["remove", "wrong"]],
      }),
    ).toThrowError();
  });

  test("removes field by applying inverted field creation", () =>
    checkApply(
      mockTask1Node.title,
      {
        op: "set",
        value: undefined,
        previous: mockTask1Node.title,
      },
      null,
    ));

  test("removes field when all array elements are removed", () => {
    checkApply(
      ["a"],
      {
        op: "seq",
        mutations: [["remove", "a", 0]],
      },
      null,
    );
  });

  test("applies set change with object values (deep equality)", () => {
    checkApply(
      {
        title: { required: true },
        description: { required: true },
      },
      {
        op: "set",
        value: { title: { required: false }, description: { required: true } },
        previous: {
          title: { required: true },
          description: { required: true },
        },
      },
      { title: { required: false }, description: { required: true } },
    );
  });
});

describe("applyChangeset", () => {
  const checkApply = (
    entity: Fieldset,
    input: FieldChangeset,
    expected: Fieldset,
  ) => {
    const result = applyChangeset(entity, input);
    expect(result).toEqual(expected);
  };

  test("applies mixed changeset", () =>
    checkApply(mockTask1Node, mockChangesetUpdateTask1, mockTaskNode1Updated));

  test("applies empty changeset", () =>
    checkApply(mockTask1Node, emptyChangeset, mockTask1Node));

  test("removes entity fields by applying inverted entity creation", () =>
    checkApply(mockTask1Node, inverseChangeset(mockChangesetCreateTask1), {
      id: null,
      uid: null,
      type: null,
      key: null,
      title: null,
      description: null,
      status: null,
      tags: null,
    }));

  test("preserves null values in patch to signal field deletion to SQL layer", () => {
    const inverseCset: FieldChangeset = {
      description: {
        op: "set",
        value: undefined,
        previous: "Product feature",
      },
      txIds: {
        op: "seq",
        mutations: [["remove", 17]],
      },
    };

    const currentValues: Fieldset = {
      description: "Product feature",
      txIds: [11, 14, 15, 17],
    };

    checkApply(currentValues, inverseCset, {
      description: null,
      txIds: [11, 14, 15],
    });
  });

  test("applies inverse changeset with txIds removal for rollback", () => {
    const entity: Fieldset = {
      id: 28,
      name: "Feature",
      description: "Product feature",
      txIds: [11, 14, 15, 17],
    };

    const tx17Changeset: FieldChangeset = {
      description: {
        op: "set",
        value: "Product feature",
      },
    };

    const inverseWithTxIds: FieldChangeset = {
      ...inverseChangeset(tx17Changeset),
      txIds: {
        op: "seq",
        mutations: [["remove", 17]],
      },
    };

    checkApply(entity, inverseWithTxIds, {
      id: 28,
      name: "Feature",
      description: null,
      txIds: [11, 14, 15],
    });
  });

  test("removes entity fields that no longer have value", () => {
    checkApply(
      mockTask1Node,
      {
        description: {
          op: "set",
          value: undefined,
          previous: mockTask1Node.description,
        },
        tags: {
          op: "seq",
          mutations: [
            ["remove", "urgent", 0],
            ["remove", "important", 0],
          ],
        },
      },
      omit({ ...mockTask1Node, description: null }, ["tags"]),
    );
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

describe("rebaseChangeset", () => {
  const checkRebase = (
    base: FieldChangeset,
    changeset: FieldChangeset,
    expected: FieldChangeset,
  ) => {
    const result = rebaseChangeset(base, changeset);
    expect(result).toEqual(expected);
  };

  test("keeps changes when base does not touch attribute", () => {
    const changeset: FieldChangeset = {
      tags: mockChangesetUpdateTask1.tags,
    };

    checkRebase(baseTitleChangeset, changeset, changeset);
  });

  test("rebases set change sharing the same ancestor", () => {
    const changeset: FieldChangeset = {
      title: {
        ...mockChangesetUpdateTask1.title,
        value: finalTitle,
      },
    };

    checkRebase(baseTitleChangeset, changeset, secondTitleChangeset);
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

    checkRebase(baseSeqAddChangeset, changeset, {
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

    checkRebase(baseSeqRemoveChangeset, changeset, {
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

    checkRebase(baseSeqAddChangeset, changeset, {
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

    checkRebase(baseSeqAddChangeset, changeset, {
      tags: {
        op: "seq",
        mutations: [["remove", "last", undefined]],
      },
    });
  });
});

describe("squashChangesets", () => {
  const checkSquash = (
    first: FieldChangeset,
    second: FieldChangeset,
    expected: FieldChangeset,
  ) => {
    const result = squashChangesets(first, second);
    expect(result).toEqual(expected);
  };

  test("squashes non-conflicting changesets", () =>
    checkSquash(baseTitleChangeset, baseSeqAddChangeset, {
      ...baseTitleChangeset,
      ...baseSeqAddChangeset,
    }));

  test("squashes set changes on same attribute", () =>
    checkSquash(baseTitleChangeset, secondTitleChangeset, {
      title: {
        op: "set",
        previous: mockTask1Node.title,
        value: finalTitle,
      },
    }));

  test("squashes sequence operations", () =>
    checkSquash(
      baseSeqAddChangeset,
      {
        tags: {
          op: "seq",
          mutations: [["insert", "beta", 1]],
        },
      },
      {
        tags: {
          op: "seq",
          mutations: [
            ["insert", "completed", 1],
            ["insert", "beta", 2],
          ],
        },
      },
    ));

  test("cancels out add followed by remove", () =>
    checkSquash(
      baseSeqAddChangeset,
      { tags: mockRemoveChange },
      emptyChangeset,
    ));

  test("squashes set followed by seq operations", () =>
    checkSquash(
      {
        tags: {
          op: "set",
          value: ["a", "b"],
          previous: undefined,
        },
      },
      {
        tags: {
          op: "seq",
          mutations: [["insert", "c", 2]],
        },
      },
      {
        tags: {
          op: "set",
          value: ["a", "b", "c"],
          previous: undefined,
        },
      },
    ));

  test("squash of changeset and its inverse is empty", () =>
    checkSquash(
      mockChangesetUpdateTask1,
      inverseChangeset(mockChangesetUpdateTask1),
      emptyChangeset,
    ));

  test("squashing preserves application order", () => {
    const squashed = squashChangesets(baseTitleChangeset, secondTitleChangeset);

    const sequential = applyChangeset(
      applyChangeset(mockTask1Node, baseTitleChangeset),
      secondTitleChangeset,
    );
    const direct = applyChangeset(mockTask1Node, squashed);

    expect(sequential).toEqual(direct);
  });

  test("squashes multiple appends", () =>
    checkSquash(
      {
        tags: {
          op: "seq",
          mutations: [["insert", "first"]],
        },
      },
      {
        tags: {
          op: "seq",
          mutations: [["insert", "second"]],
        },
      },
      {
        tags: {
          op: "seq",
          mutations: [
            ["insert", "first", undefined],
            ["insert", "second", undefined],
          ],
        },
      },
    ));

  test("adjusts positions of remaining mutations after cancellation", () =>
    checkSquash(
      {
        items: {
          op: "seq",
          mutations: [
            ["insert", 17, 2],
            ["remove", 15, 6],
          ],
        },
      },
      {
        items: {
          op: "seq",
          mutations: [["remove", 17, 2]],
        },
      },
      {
        items: {
          op: "seq",
          mutations: [["remove", 15, 5]],
        },
      },
    ));
});

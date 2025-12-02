import { describe, expect, test } from "bun:test";
import { omit } from "@binder/utils";
import {
  mockChangesetCreateTask1,
  mockChangesetInvert,
  mockChangesetUpdateTask1,
  mockRemoveChange,
  mockTitleSetChange,
} from "./changeset.mock.ts";
import {
  applyChange,
  applyChangeset,
  emptyChangeset,
  type FieldChangeset,
  inverseChange,
  inverseChangeset,
  inverseMutation,
  type ListMutationPatch,
  normalizeValueChange,
  rebaseChangeset,
  squashChangesets,
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

  test("normalizes string FieldValue to ValueChange with set", () =>
    checkNormalized("hello", ["set", "hello"]));

  test("normalizes number FieldValue to ValueChange with set", () =>
    checkNormalized(42, ["set", 42]));

  test("normalizes null FieldValue to ValueChange with set", () =>
    checkNormalized(null, ["set", null]));

  test("normalizes array FieldValue to ValueChange with set", () =>
    checkNormalized([1, 2, 3], ["set", [1, 2, 3]]));

  test("passes through ValueChange with set unchanged", () => {
    const valueChange: ValueChange = ["set", "world", "hello"];
    checkNormalized(valueChange, valueChange);
  });

  test("passes through ValueChange with seq unchanged", () => {
    const valueChange: ValueChange = ["seq", [["insert", "item", 0]]];
    checkNormalized(valueChange, valueChange);
  });
});

describe("inverseChange", () => {
  test("inverts set change", () => {
    const result = inverseChange(mockTitleSetChange);
    expect(result).toEqual([
      "set",
      mockTask1Node.title,
      mockTaskNode1Updated.title,
    ]);
  });

  test("inverts remove change to add", () => {
    const result = inverseChange(mockRemoveChange);
    expect(result).toEqual(mockChangesetUpdateTask1.tags);
  });

  test("inverts seq patch mutation", () => {
    const mutation: ListMutationPatch = [
      "patch",
      "user-1",
      { role: ["set", "admin", "viewer"] },
    ];

    expect(inverseMutation(mutation)).toEqual([
      "patch",
      "user-1",
      { role: ["set", "viewer", "admin"] },
    ]);
  });

  test("inverts single relation patch", () => {
    const change: ValueChange = ["patch", { role: ["set", "admin", "viewer"] }];

    expect(inverseChange(change)).toEqual([
      "patch",
      { role: ["set", "viewer", "admin"] },
    ]);
  });

  test("applying seq patch then its inverse returns original", () => {
    const original: FieldValue = [["user-1", { role: "viewer" }]];
    const change: ValueChange = [
      "seq",
      [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
    ];

    const patched = applyChange(original, change);
    const restored = applyChange(patched, inverseChange(change));

    expect(restored).toEqual(original);
  });

  test("applying single relation patch then its inverse returns original", () => {
    const original: FieldValue = ["user-1", { role: "viewer" }];
    const change: ValueChange = ["patch", { role: ["set", "admin", "viewer"] }];

    const patched = applyChange(original, change);
    const restored = applyChange(patched, inverseChange(change));

    expect(restored).toEqual(original);
  });

  test("applying change then its inverse returns original value", () => {
    expect(
      applyChange(
        mockTaskNode1Updated.title,
        inverseChange(mockTitleSetChange),
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
      mockTitleSetChange,
      mockTaskNode1Updated.title,
    );
  });

  test("applies remove change", () => {
    checkApply(mockTaskNode1Updated.tags, mockRemoveChange, mockTask1Node.tags);
  });

  test("throws when remove mutation targets missing value", () => {
    expect(() =>
      applyChange(mockTask1Node.tags, ["seq", [["remove", "completed", 1]]]),
    ).toThrowError();
  });

  test("applies insert with undefined position (append)", () =>
    checkApply(
      ["a", "b", "c"],
      ["seq", [["insert", "d"]]],
      ["a", "b", "c", "d"],
    ));

  test("applies remove with undefined position (remove last)", () =>
    checkApply(["a", "b", "c"], ["seq", [["remove", "c"]]], ["a", "b"]));

  test("applies multiple appends in sequence", () =>
    checkApply(
      ["a"],
      [
        "seq",
        [
          ["insert", "b"],
          ["insert", "c"],
        ],
      ],
      ["a", "b", "c"],
    ));

  test("throws when remove-last targets wrong value", () => {
    expect(() =>
      applyChange(["a", "b", "c"], ["seq", [["remove", "wrong"]]]),
    ).toThrowError();
  });

  test("removes field by applying inverted field creation", () =>
    checkApply(mockTask1Node.title, ["clear", mockTask1Node.title], null));

  test("removes field when all array elements are removed", () => {
    checkApply(["a"], ["seq", [["remove", "a", 0]]], null);
  });

  test("applies set change with object values (deep equality)", () => {
    checkApply(
      {
        title: { required: true },
        description: { required: true },
      },
      [
        "set",
        { title: { required: false }, description: { required: true } },
        { title: { required: true }, description: { required: true } },
      ],
      { title: { required: false }, description: { required: true } },
    );
  });

  test("patches attributes on a simple ref (converts to tuple)", () =>
    checkApply(
      ["user-1", "user-2"],
      ["seq", [["patch", "user-1", { role: "admin" }]]],
      [["user-1", { role: "admin" }], "user-2"],
    ));

  test("patches attributes on existing tuple", () =>
    checkApply(
      [["user-1", { role: "viewer" }], "user-2"],
      ["seq", [["patch", "user-1", { role: ["set", "admin", "viewer"] }]]],
      [["user-1", { role: "admin" }], "user-2"],
    ));

  test("patches multiple attributes", () =>
    checkApply(
      [["user-1", { role: "viewer" }]],
      [
        "seq",
        [
          [
            "patch",
            "user-1",
            {
              role: ["set", "admin", "viewer"],
              percentage: ["set", 50],
            },
          ],
        ],
      ],
      [["user-1", { role: "admin", percentage: 50 }]],
    ));

  test("throws when patching non-existent ref", () => {
    expect(() =>
      applyChange(
        ["user-1", "user-2"],
        ["seq", [["patch", "user-3", { role: "admin" }]]],
      ),
    ).toThrowError(/not found/);
  });

  test("combines patch with insert/remove", () =>
    checkApply(
      ["user-1"],
      [
        "seq",
        [
          ["insert", "user-2"],
          ["patch", "user-1", { role: "lead" }],
        ],
      ],
      [["user-1", { role: "lead" }], "user-2"],
    ));

  test("applies patch on single relation value", () =>
    checkApply(
      "user-1",
      ["patch", { role: "admin" }],
      ["user-1", { role: "admin" }],
    ));

  test("applies patch on existing single relation tuple", () =>
    checkApply(
      ["user-1", { role: "viewer" }],
      ["patch", { role: ["set", "admin", "viewer"] }],
      ["user-1", { role: "admin" }],
    ));
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
      description: ["clear", "Product feature"],
      txIds: ["seq", [["remove", 17]]],
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
      description: ["set", "Product feature"],
    };

    const inverseWithTxIds: FieldChangeset = {
      ...inverseChangeset(tx17Changeset),
      txIds: ["seq", [["remove", 17]]],
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
        description: ["clear", mockTask1Node.description],
        tags: [
          "seq",
          [
            ["remove", "urgent", 0],
            ["remove", "important", 0],
          ],
        ],
      },
      omit({ ...mockTask1Node, description: null }, ["tags"]),
    );
  });
});

const finalTitle = "Final";
const baseTitleChangeset: FieldChangeset = {
  title: mockTitleSetChange,
};
const baseSeqAddChangeset: FieldChangeset = {
  tags: mockChangesetUpdateTask1.tags,
};
const baseSeqRemoveChangeset: FieldChangeset = { tags: mockRemoveChange };
const secondTitleChangeset: FieldChangeset = {
  title: ["set", finalTitle, mockTaskNode1Updated.title],
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
      title: ["set", finalTitle, mockTask1Node.title],
    };

    checkRebase(baseTitleChangeset, changeset, secondTitleChangeset);
  });

  test("throws when rebasing a conflicting set change", () => {
    const changeset: FieldChangeset = {
      title: ["set", finalTitle, "Other"],
    };

    expect(() => rebaseChangeset(baseTitleChangeset, changeset)).toThrowError(
      /Cannot rebase set change/,
    );
  });

  test("adjusts positions when rebasing add operations", () => {
    const changeset: FieldChangeset = {
      tags: ["seq", [["insert", "beta", 3]]],
    };

    checkRebase(baseSeqAddChangeset, changeset, {
      tags: ["seq", [["insert", "beta", 4]]],
    });
  });

  test("adjusts positions when rebasing remove operations", () => {
    const changeset: FieldChangeset = {
      tags: ["seq", [["remove", "gamma", 3]]],
    };

    checkRebase(baseSeqRemoveChangeset, changeset, {
      tags: ["seq", [["remove", "gamma", 2]]],
    });
  });

  test("throws when rebasing remove operations targeting the same element", () => {
    const conflictingRemoval: FieldChangeset = {
      tags: ["seq", [["remove", "completed", 1]]],
    };

    expect(() =>
      rebaseChangeset(baseSeqRemoveChangeset, conflictingRemoval),
    ).toThrowError();
  });

  test("keeps undefined position when rebasing append", () => {
    const changeset: FieldChangeset = {
      tags: ["seq", [["insert", "new"]]],
    };

    checkRebase(baseSeqAddChangeset, changeset, {
      tags: ["seq", [["insert", "new", undefined]]],
    });
  });

  test("keeps undefined position when rebasing remove-last", () => {
    const changeset: FieldChangeset = {
      tags: ["seq", [["remove", "last"]]],
    };

    checkRebase(baseSeqAddChangeset, changeset, {
      tags: ["seq", [["remove", "last", undefined]]],
    });
  });

  test("rebases patch when no conflict", () => {
    const base: FieldChangeset = {
      owners: ["seq", [["insert", "user-3"]]],
    };

    const changeset: FieldChangeset = {
      owners: ["seq", [["patch", "user-1", { role: "admin" }]]],
    };

    checkRebase(base, changeset, changeset);
  });

  test("rebases seq patch on same ref by rebasing nested changeset", () => {
    const base: FieldChangeset = {
      owners: [
        "seq",
        [["patch", "user-1", { role: ["set", "editor", "viewer"] }]],
      ],
    };

    const changeset: FieldChangeset = {
      owners: [
        "seq",
        [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
      ],
    };

    checkRebase(base, changeset, {
      owners: [
        "seq",
        [["patch", "user-1", { role: ["set", "admin", "editor"] }]],
      ],
    });
  });

  test("rebases single relation patch on same field", () => {
    const base: FieldChangeset = {
      owner: ["patch", { role: ["set", "editor", "viewer"] }],
    };

    const changeset: FieldChangeset = {
      owner: ["patch", { role: ["set", "admin", "viewer"] }],
    };

    checkRebase(base, changeset, {
      owner: ["patch", { role: ["set", "admin", "editor"] }],
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
      title: ["set", finalTitle, mockTask1Node.title],
    }));

  test("squashes sequence operations", () =>
    checkSquash(
      baseSeqAddChangeset,
      { tags: ["seq", [["insert", "beta", 1]]] },
      {
        tags: [
          "seq",
          [
            ["insert", "completed", 1],
            ["insert", "beta", 2],
          ],
        ],
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
      { tags: ["set", ["a", "b"]] },
      { tags: ["seq", [["insert", "c", 2]]] },
      { tags: ["set", ["a", "b", "c"]] },
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
      { tags: ["seq", [["insert", "first"]]] },
      { tags: ["seq", [["insert", "second"]]] },
      {
        tags: [
          "seq",
          [
            ["insert", "first", undefined],
            ["insert", "second", undefined],
          ],
        ],
      },
    ));

  test("adjusts positions of remaining mutations after cancellation", () =>
    checkSquash(
      {
        items: [
          "seq",
          [
            ["insert", 17, 2],
            ["remove", 15, 6],
          ],
        ],
      },
      { items: ["seq", [["remove", 17, 2]]] },
      { items: ["seq", [["remove", 15, 5]]] },
    ));

  test("squashes consecutive seq patches on same ref", () =>
    checkSquash(
      {
        owners: [
          "seq",
          [["patch", "user-1", { role: ["set", "editor", "viewer"] }]],
        ],
      },
      {
        owners: [
          "seq",
          [["patch", "user-1", { role: ["set", "admin", "editor"] }]],
        ],
      },
      {
        owners: [
          "seq",
          [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
        ],
      },
    ));

  test("squashes consecutive single relation patches", () =>
    checkSquash(
      { owner: ["patch", { role: ["set", "editor", "viewer"] }] },
      { owner: ["patch", { role: ["set", "admin", "editor"] }] },
      { owner: ["patch", { role: ["set", "admin", "viewer"] }] },
    ));

  test("squashes set followed by single relation patch", () =>
    checkSquash(
      { owner: ["set", "user-1"] },
      { owner: ["patch", { role: "admin" }] },
      { owner: ["set", ["user-1", { role: "admin" }]] },
    ));

  test("keeps patches on different refs separate", () =>
    checkSquash(
      { owners: ["seq", [["patch", "user-1", { role: "admin" }]]] },
      { owners: ["seq", [["patch", "user-2", { role: "viewer" }]]] },
      {
        owners: [
          "seq",
          [
            ["patch", "user-1", { role: "admin" }],
            ["patch", "user-2", { role: "viewer" }],
          ],
        ],
      },
    ));

  test("squashes patch that undoes previous patch leaves empty patch", () =>
    checkSquash(
      {
        owners: [
          "seq",
          [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
        ],
      },
      {
        owners: [
          "seq",
          [["patch", "user-1", { role: ["set", "viewer", "admin"] }]],
        ],
      },
      { owners: ["seq", [["patch", "user-1", {}]]] },
    ));
});

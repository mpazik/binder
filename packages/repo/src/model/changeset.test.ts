import { describe, expect, it } from "bun:test";
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
  canonicalizeFieldChangeset,
  emptyChangeset,
  type FieldChangeset,
  inverseChange,
  inverseChangeset,
  inverseMutation,
  type ListMutationPatch,
  mapChangesetValues,
  normalizeValueChange,
  rebaseChangeset,
  squashChangesets,
  type ValueChange,
} from "./changeset.ts";
import { mockRecordSchema } from "./schema.mock.ts";
import { mockTask1Record, mockTaskRecord1Updated } from "./record.mock.ts";
import type { Fieldset, FieldValue } from "./field.ts";

describe("changeset", () => {
  describe("normalizeValueChange", () => {
    const check = (input: ValueChange | FieldValue, expected: ValueChange) => {
      expect(normalizeValueChange(input)).toEqual(expected);
    };

    it("normalizes string FieldValue to ValueChange with set", () =>
      check("hello", ["set", "hello"]));

    it("normalizes number FieldValue to ValueChange with set", () =>
      check(42, ["set", 42]));

    it("normalizes null FieldValue to ValueChange with set", () =>
      check(null, ["set", null]));

    it("normalizes array FieldValue to ValueChange with set", () =>
      check([1, 2, 3], ["set", [1, 2, 3]]));

    it("passes through ValueChange with set unchanged", () => {
      const valueChange: ValueChange = ["set", "world", "hello"];
      check(valueChange, valueChange);
    });

    it("passes through ValueChange with seq unchanged", () => {
      const valueChange: ValueChange = ["seq", [["insert", "item", 0]]];
      check(valueChange, valueChange);
    });
  });

  describe("inverseChange", () => {
    it("inverts set change", () => {
      expect(inverseChange(mockTitleSetChange)).toEqual([
        "set",
        mockTask1Record.title,
        mockTaskRecord1Updated.title,
      ]);
    });

    it("inverts remove change to add", () => {
      expect(inverseChange(mockRemoveChange)).toEqual(
        mockChangesetUpdateTask1.tags as ValueChange,
      );
    });

    it("inverts seq patch mutation", () => {
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

    it("inverts single relation patch", () => {
      const change: ValueChange = [
        "patch",
        { role: ["set", "admin", "viewer"] },
      ];

      expect(inverseChange(change)).toEqual([
        "patch",
        { role: ["set", "viewer", "admin"] },
      ]);
    });

    it("applying seq patch then its inverse returns original", () => {
      const original: FieldValue = [["user-1", { role: "viewer" }]];
      const change: ValueChange = [
        "seq",
        [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
      ];

      const patched = applyChange(original, change);
      expect(applyChange(patched, inverseChange(change))).toEqual(original);
    });

    it("applying single relation patch then its inverse returns original", () => {
      const original: FieldValue = ["user-1", { role: "viewer" }];
      const change: ValueChange = [
        "patch",
        { role: ["set", "admin", "viewer"] },
      ];

      const patched = applyChange(original, change);
      expect(applyChange(patched, inverseChange(change))).toEqual(original);
    });

    it("applying change then its inverse returns original value", () => {
      expect(
        applyChange(
          mockTaskRecord1Updated.title,
          inverseChange(mockTitleSetChange),
        ),
      ).toEqual(mockTask1Record.title);
    });

    it("applying change then its inverse removes field", () => {
      expect(
        applyChange(
          mockTask1Record.title,
          inverseChange(normalizeValueChange(mockChangesetCreateTask1.title)),
        ),
      ).toEqual(null);
    });
  });

  describe("inverseChangeset", () => {
    it("inverts all attribute changes", () => {
      expect(inverseChangeset(mockChangesetUpdateTask1)).toEqual(
        mockChangesetInvert,
      );
    });

    it("double inversion returns original changeset", () => {
      expect(
        inverseChangeset(inverseChangeset(mockChangesetUpdateTask1)),
      ).toEqual(mockChangesetUpdateTask1);
    });
  });

  describe("applyChange", () => {
    const check = (
      entity: FieldValue,
      input: ValueChange,
      expected: FieldValue,
    ) => {
      expect(applyChange(entity, input)).toEqual(expected);
    };

    it("applies set change", () => {
      check(
        mockTask1Record.title,
        mockTitleSetChange,
        mockTaskRecord1Updated.title,
      );
    });

    it("applies remove change", () => {
      check(
        mockTaskRecord1Updated.tags,
        mockRemoveChange,
        mockTask1Record.tags,
      );
    });

    it("throws when remove mutation targets missing value", () => {
      expect(() =>
        applyChange(mockTask1Record.tags, [
          "seq",
          [["remove", "completed", 1]],
        ]),
      ).toThrowError();
    });

    it("applies insert with undefined position (append)", () =>
      check(["a", "b", "c"], ["seq", [["insert", "d"]]], ["a", "b", "c", "d"]));

    it("applies remove with undefined position (remove last)", () =>
      check(["a", "b", "c"], ["seq", [["remove", "c"]]], ["a", "b"]));

    it("applies remove with null position as positionless (JSON round-trip)", () =>
      check(
        ["urgent", "important"],
        ["seq", [["remove", "urgent", null as unknown as number]]],
        ["important"],
      ));

    it("applies insert with null position as append (JSON round-trip)", () =>
      check(
        ["a", "b"],
        ["seq", [["insert", "c", null as unknown as number]]],
        ["a", "b", "c"],
      ));

    it("applies multiple appends in sequence", () =>
      check(
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

    it("throws when remove-last targets wrong value", () => {
      expect(() =>
        applyChange(["a", "b", "c"], ["seq", [["remove", "wrong"]]]),
      ).toThrowError();
    });

    // When a list item changes (e.g. trailing whitespace trimmed during doc
    // sync), the diff emits [remove, insert] with no explicit positions.
    // Transaction canonicalization reorders these to [insert, remove].
    // The insert appends to the array, shifting the last index away from
    // the original item. The remove must search by value rather than
    // blindly targeting the last element.
    it("removes correct item when insert-before-remove shifts the last index after canonicalization", () =>
      check(
        ["old value\n"],
        [
          "seq",
          [
            ["insert", "new value"],
            ["remove", "old value\n"],
          ],
        ],
        ["new value"],
      ));

    it("removes field by applying inverted field creation", () =>
      check(mockTask1Record.title, ["clear", mockTask1Record.title], null));

    it("removes field when all array elements are removed", () => {
      check(["a"], ["seq", [["remove", "a", 0]]], null);
    });

    it("applies set change with object values (deep equality)", () => {
      check(
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

    it("patches attributes on a simple ref (converts to tuple)", () =>
      check(
        ["user-1", "user-2"],
        ["seq", [["patch", "user-1", { role: "admin" }]]],
        [["user-1", { role: "admin" }], "user-2"],
      ));

    it("patches attributes on existing tuple", () =>
      check(
        [["user-1", { role: "viewer" }], "user-2"],
        ["seq", [["patch", "user-1", { role: ["set", "admin", "viewer"] }]]],
        [["user-1", { role: "admin" }], "user-2"],
      ));

    it("patches multiple attributes", () =>
      check(
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

    it("throws when patching non-existent ref", () => {
      expect(() =>
        applyChange(
          ["user-1", "user-2"],
          ["seq", [["patch", "user-3", { role: "admin" }]]],
        ),
      ).toThrowError(/not found/);
    });

    it("combines patch with insert/remove", () =>
      check(
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

    it("applies patch on single relation value", () =>
      check(
        "user-1",
        ["patch", { role: "admin" }],
        ["user-1", { role: "admin" }],
      ));

    it("applies patch on existing single relation tuple", () =>
      check(
        ["user-1", { role: "viewer" }],
        ["patch", { role: ["set", "admin", "viewer"] }],
        ["user-1", { role: "admin" }],
      ));
  });

  describe("applyChangeset", () => {
    const check = (
      entity: Fieldset,
      input: FieldChangeset,
      expected: Fieldset,
    ) => {
      expect(applyChangeset(entity, input)).toEqual(expected);
    };

    it("applies mixed changeset", () =>
      check(mockTask1Record, mockChangesetUpdateTask1, mockTaskRecord1Updated));

    it("applies empty changeset", () =>
      check(mockTask1Record, emptyChangeset, mockTask1Record));

    it("removes entity fields by applying inverted entity creation", () =>
      check(mockTask1Record, inverseChangeset(mockChangesetCreateTask1), {
        id: null,
        uid: null,
        type: null,
        key: null,
        title: null,
        description: null,
        status: null,
        priority: null,
        tags: null,
      }));

    it("preserves null values in patch to signal field deletion to SQL layer", () => {
      check(
        {
          description: "Product feature",
          txIds: [11, 14, 15, 17],
        },
        {
          description: ["clear", "Product feature"],
          txIds: ["seq", [["remove", 17]]],
        },
        {
          description: null,
          txIds: [11, 14, 15],
        },
      );
    });

    it("applies inverse changeset with txIds removal for rollback", () => {
      const tx17Changeset: FieldChangeset = {
        description: ["set", "Product feature"],
      };

      check(
        {
          id: 28,
          name: "Feature",
          description: "Product feature",
          txIds: [11, 14, 15, 17],
        },
        {
          ...inverseChangeset(tx17Changeset),
          txIds: ["seq", [["remove", 17]]],
        },
        {
          id: 28,
          name: "Feature",
          description: null,
          txIds: [11, 14, 15],
        },
      );
    });

    it("removes entity fields that no longer have value", () => {
      check(
        mockTask1Record,
        {
          description: ["clear", mockTask1Record.description],
          tags: [
            "seq",
            [
              ["remove", "urgent", 0],
              ["remove", "important", 0],
            ],
          ],
        },
        omit({ ...mockTask1Record, description: null }, ["tags"]),
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
    title: ["set", finalTitle, mockTaskRecord1Updated.title],
  };

  describe("rebaseChangeset", () => {
    const check = (
      base: FieldChangeset,
      changeset: FieldChangeset,
      expected: FieldChangeset,
    ) => {
      expect(rebaseChangeset(base, changeset)).toEqual(expected);
    };

    it("keeps changes when base does not touch attribute", () => {
      const changeset: FieldChangeset = {
        tags: mockChangesetUpdateTask1.tags,
      };

      check(baseTitleChangeset, changeset, changeset);
    });

    it("rebases set change sharing the same ancestor", () => {
      check(
        baseTitleChangeset,
        { title: ["set", finalTitle, mockTask1Record.title] },
        secondTitleChangeset,
      );
    });

    it("throws when rebasing a conflicting set change", () => {
      expect(() =>
        rebaseChangeset(baseTitleChangeset, {
          title: ["set", finalTitle, "Other"],
        }),
      ).toThrowError(/Cannot rebase set change/);
    });

    it("adjusts positions when rebasing add operations", () => {
      check(
        baseSeqAddChangeset,
        { tags: ["seq", [["insert", "beta", 3]]] },
        { tags: ["seq", [["insert", "beta", 4]]] },
      );
    });

    it("adjusts positions when rebasing remove operations", () => {
      check(
        baseSeqRemoveChangeset,
        { tags: ["seq", [["remove", "gamma", 3]]] },
        { tags: ["seq", [["remove", "gamma", 2]]] },
      );
    });

    it("throws when rebasing remove operations targeting the same element", () => {
      expect(() =>
        rebaseChangeset(baseSeqRemoveChangeset, {
          tags: ["seq", [["remove", "completed", 1]]],
        }),
      ).toThrowError();
    });

    it("keeps undefined position when rebasing append", () => {
      check(
        baseSeqAddChangeset,
        { tags: ["seq", [["insert", "new"]]] },
        { tags: ["seq", [["insert", "new", undefined]]] },
      );
    });

    it("keeps undefined position when rebasing remove-last", () => {
      check(
        baseSeqAddChangeset,
        { tags: ["seq", [["remove", "last"]]] },
        { tags: ["seq", [["remove", "last", undefined]]] },
      );
    });

    it("rebases patch when no conflict", () => {
      const changeset: FieldChangeset = {
        owners: ["seq", [["patch", "user-1", { role: "admin" }]]],
      };

      check({ owners: ["seq", [["insert", "user-3"]]] }, changeset, changeset);
    });

    it("rebases seq patch on same ref by rebasing nested changeset", () => {
      check(
        {
          owners: [
            "seq",
            [["patch", "user-1", { role: ["set", "editor", "viewer"] }]],
          ],
        },
        {
          owners: [
            "seq",
            [["patch", "user-1", { role: ["set", "admin", "viewer"] }]],
          ],
        },
        {
          owners: [
            "seq",
            [["patch", "user-1", { role: ["set", "admin", "editor"] }]],
          ],
        },
      );
    });

    it("rebases single relation patch on same field", () => {
      check(
        { owner: ["patch", { role: ["set", "editor", "viewer"] }] },
        { owner: ["patch", { role: ["set", "admin", "viewer"] }] },
        { owner: ["patch", { role: ["set", "admin", "editor"] }] },
      );
    });
  });

  describe("squashChangesets", () => {
    const check = (
      first: FieldChangeset,
      second: FieldChangeset,
      expected: FieldChangeset,
    ) => {
      expect(squashChangesets(first, second)).toEqual(expected);
    };

    it("squashes non-conflicting changesets", () =>
      check(baseTitleChangeset, baseSeqAddChangeset, {
        ...baseTitleChangeset,
        ...baseSeqAddChangeset,
      }));

    it("squashes set changes on same attribute", () =>
      check(baseTitleChangeset, secondTitleChangeset, {
        title: ["set", finalTitle, mockTask1Record.title],
      }));

    it("squashes sequence operations", () =>
      check(
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

    it("cancels out add followed by remove", () =>
      check(baseSeqAddChangeset, { tags: mockRemoveChange }, emptyChangeset));

    it("squashes set followed by seq operations", () =>
      check(
        { tags: ["set", ["a", "b"]] },
        { tags: ["seq", [["insert", "c", 2]]] },
        { tags: ["set", ["a", "b", "c"]] },
      ));

    it("squash of changeset and its inverse is empty", () =>
      check(
        mockChangesetUpdateTask1,
        inverseChangeset(mockChangesetUpdateTask1),
        emptyChangeset,
      ));

    it("squashing preserves application order", () => {
      const squashed = squashChangesets(
        baseTitleChangeset,
        secondTitleChangeset,
      );

      const sequential = applyChangeset(
        applyChangeset(mockTask1Record, baseTitleChangeset),
        secondTitleChangeset,
      );

      expect(sequential).toEqual(applyChangeset(mockTask1Record, squashed));
    });

    it("squashes multiple appends", () =>
      check(
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

    it("squashes multiple appends with null positions", () =>
      check(
        { log: ["seq", [["insert", "first entry", null]]] },
        { log: ["seq", [["insert", "second entry", null]]] },
        {
          log: [
            "seq",
            [
              ["insert", "first entry", null],
              ["insert", "second entry", null],
            ],
          ],
        },
      ));

    it("squashed seq appends with null positions apply to empty entity", () => {
      const create: FieldChangeset = {
        key: "day-1",
        type: "Day",
      };
      const updates: FieldChangeset[] = [
        { log: ["seq", [["insert", "first", null]]] },
        { log: ["seq", [["insert", "second", null]]] },
        { log: ["seq", [["insert", "third", null]]] },
      ];

      let squashed = create;
      for (const u of updates) {
        squashed = squashChangesets(squashed, u);
      }

      const [, mutations] = squashed.log as ["seq", unknown[][]];
      for (const m of mutations) {
        expect(m[2]).toBeNull();
      }

      expect(applyChangeset({} as Fieldset, squashed)).toEqual({
        key: "day-1",
        type: "Day",
        log: ["first", "second", "third"],
      });
    });

    it("adjusts positions of remaining mutations after cancellation", () =>
      check(
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

    it("squashes consecutive seq patches on same ref", () =>
      check(
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

    it("squashes consecutive single relation patches", () =>
      check(
        { owner: ["patch", { role: ["set", "editor", "viewer"] }] },
        { owner: ["patch", { role: ["set", "admin", "editor"] }] },
        { owner: ["patch", { role: ["set", "admin", "viewer"] }] },
      ));

    it("squashes set followed by single relation patch", () =>
      check(
        { owner: ["set", "user-1"] },
        { owner: ["patch", { role: "admin" }] },
        { owner: ["set", ["user-1", { role: "admin" }]] },
      ));

    it("keeps patches on different refs separate", () =>
      check(
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

    it("squashes patch that undoes previous patch leaves empty patch", () =>
      check(
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

  describe("diff changes", () => {
    const diff = (ops: ValueChange[1]): ValueChange => ["diff", ops as never];

    it("applies diff to a string field", () => {
      const change: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      expect(applyChange("the cat sat", change)).toBe("the dog sat");
    });

    it("applies diff to a null field", () => {
      const change: ValueChange = ["diff", [["insert", "hello"]]];
      expect(applyChange(null, change)).toBe("hello");
    });

    it("returns null when diff result is empty", () => {
      const change: ValueChange = ["diff", [["delete", "hello"]]];
      expect(applyChange("hello", change)).toBeNull();
    });

    it("inverts a diff change", () => {
      const change: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      expect(inverseChange(change)).toEqual([
        "diff",
        [
          ["retain", 4],
          ["delete", "dog"],
          ["insert", "cat"],
        ],
      ]);
    });

    it("round-trips diff via apply + inverse", () => {
      const change: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      const after = applyChange("the cat sat", change);
      expect(applyChange(after, inverseChange(change))).toBe("the cat sat");
    });

    it("squashes set followed by diff into a new set", () => {
      const changeset = squashChangesets(
        { description: ["set", "the cat sat"] },
        {
          description: [
            "diff",
            [
              ["retain", 4],
              ["delete", "cat"],
              ["insert", "dog"],
            ],
          ],
        },
      );
      expect(changeset).toEqual({ description: ["set", "the dog sat"] });
    });

    it("squashes two diffs by composing their ops", () => {
      const first: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 5],
            ["insert", " world"],
          ],
        ],
      };
      const second: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 11],
            ["insert", "!"],
          ],
        ],
      };
      const squashed = squashChangesets(first, second);
      expect(applyChangeset({ description: "hello" }, squashed)).toEqual({
        description: "hello world!",
      });
    });

    it("squashes diff followed by clear into a clear carrying the pre-diff value", () => {
      // Pre-diff: "the cat sat". Diff rewrites cat → dog. Clear wipes the field.
      const diffOps: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      const squashed = squashChangesets(
        { description: diffOps },
        { description: ["clear", "the dog sat"] },
      );
      // Squashed change must apply cleanly to the pre-diff value.
      expect(squashed).toEqual({
        description: ["clear", "the cat sat"],
      });
      expect(applyChangeset({ description: "the cat sat" }, squashed)).toEqual({
        description: null,
      });
    });

    it("squashes diff followed by set into a set carrying the pre-diff value", () => {
      const diffOps: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      const squashed = squashChangesets(
        { description: diffOps },
        { description: ["set", "goodbye", "the dog sat"] },
      );
      expect(squashed).toEqual({
        description: ["set", "goodbye", "the cat sat"],
      });
      expect(applyChangeset({ description: "the cat sat" }, squashed)).toEqual({
        description: "goodbye",
      });
    });

    it("rebase of concurrent diff and set on same field reports conflict", () => {
      const base: FieldChangeset = {
        description: ["set", "new", "the cat sat"],
      };
      const concurrent: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 4],
            ["delete", "cat"],
            ["insert", "dog"],
          ],
        ],
      };
      expect(() => rebaseChangeset(base, concurrent)).toThrow();
      expect(() => rebaseChangeset(concurrent, base)).toThrow();
    });

    it("rebase of concurrent diff and clear on same field reports conflict", () => {
      const base: FieldChangeset = {
        description: ["clear", "the cat sat"],
      };
      const concurrent: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 4],
            ["delete", "cat"],
            ["insert", "dog"],
          ],
        ],
      };
      expect(() => rebaseChangeset(base, concurrent)).toThrow();
      expect(() => rebaseChangeset(concurrent, base)).toThrow();
    });

    it("squash of diff and its inverse is empty", () => {
      const change: ValueChange = [
        "diff",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
      ];
      expect(
        squashChangesets(
          { description: change },
          { description: inverseChange(change) },
        ),
      ).toEqual(emptyChangeset);
    });

    it("rebases non-overlapping concurrent diffs", () => {
      const base: FieldChangeset = {
        description: [
          "diff",
          [
            ["insert", "HELLO"],
            ["delete", "hello"],
          ],
        ],
      };
      const concurrent: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 6],
            ["delete", "world"],
            ["insert", "WORLD"],
          ],
        ],
      };
      const rebased = rebaseChangeset(base, concurrent);
      const afterBase = applyChangeset({ description: "hello world" }, base);
      expect(applyChangeset(afterBase, rebased)).toEqual({
        description: "HELLO WORLD",
      });
    });

    it("throws on rebasing overlapping deletes", () => {
      const base: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 1],
            ["delete", "ell"],
          ],
        ],
      };
      const concurrent: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 2],
            ["delete", "llo"],
          ],
        ],
      };
      expect(() => rebaseChangeset(base, concurrent)).toThrow();
    });

    // Reference `diff` to keep the alias around for future tests without
    // tripping the unused-binding lint.
    it("normalizes a diff change as-is", () => {
      const change = diff([["insert", "x"]]);
      expect(normalizeValueChange(change)).toEqual(change);
    });

    it("canonicalizes diff ops inside a field changeset", () => {
      const raw: FieldChangeset = {
        description: [
          "diff",
          [
            ["retain", 0],
            ["retain", 4],
            ["insert", "a"],
            ["insert", "b"],
            ["delete", "x"],
            ["retain", 5],
          ],
        ],
      };
      const canonical = canonicalizeFieldChangeset(mockRecordSchema, raw);
      expect(canonical).toEqual({
        description: [
          "diff",
          [
            ["retain", 4],
            ["delete", "x"],
            ["insert", "ab"],
          ],
        ],
      });
    });
  });

  describe("mapChangesetValues", () => {
    const upper = (v: FieldValue): FieldValue =>
      typeof v === "string" ? v.toUpperCase() : v;

    const check = (input: FieldChangeset, expected: FieldChangeset) => {
      expect(mapChangesetValues(input, upper)).toEqual(expected);
    };

    it("maps plain values", () => {
      check(
        { title: "hello", count: 42 },
        { title: ["set", "HELLO"], count: ["set", 42] },
      );
    });

    it("maps set with previous", () => {
      check({ title: ["set", "new", "old"] }, { title: ["set", "NEW", "OLD"] });
    });

    it("maps set without previous", () => {
      check({ title: ["set", "new"] }, { title: ["set", "NEW"] });
    });

    it("maps clear", () => {
      check({ title: ["clear", "old"] }, { title: ["clear", "OLD"] });
    });

    it("maps seq with positions", () => {
      check(
        {
          tags: [
            "seq",
            [
              ["insert", "new-tag", 0],
              ["remove", "old-tag", 1],
            ],
          ],
        },
        {
          tags: [
            "seq",
            [
              ["insert", "NEW-TAG", 0],
              ["remove", "OLD-TAG", 1],
            ],
          ],
        },
      );
    });

    it("maps seq without positions", () => {
      check(
        {
          tags: [
            "seq",
            [
              ["insert", "a"],
              ["remove", "b"],
            ],
          ],
        },
        {
          tags: [
            "seq",
            [
              ["insert", "A"],
              ["remove", "B"],
            ],
          ],
        },
      );
    });

    it("recurses into seq patch mutations", () => {
      check(
        {
          owners: [
            "seq",
            [["patch", "user-1", { role: ["set", "admin", "lead"] }]],
          ],
        },
        {
          owners: [
            "seq",
            [["patch", "user-1", { role: ["set", "ADMIN", "LEAD"] }]],
          ],
        },
      );
    });

    it("recurses into patch change", () => {
      check(
        { metadata: ["patch", { label: ["set", "new", "old"] }] },
        { metadata: ["patch", { label: ["set", "NEW", "OLD"] }] },
      );
    });

    it("passes diff through unchanged", () => {
      check(
        {
          description: [
            "diff",
            [
              ["retain", 5],
              ["insert", "hello"],
            ],
          ],
        },
        {
          description: [
            "diff",
            [
              ["retain", 5],
              ["insert", "hello"],
            ],
          ],
        },
      );
    });

    it("maps nested arrays", () => {
      check({ refs: ["set", ["a", "b"]] }, { refs: ["set", ["A", "B"]] });
    });

    it("maps nested objects", () => {
      check(
        { meta: ["set", { label: "hello" }] },
        { meta: ["set", { label: "HELLO" }] },
      );
    });

    it("returns empty changeset for empty input", () => {
      check(emptyChangeset, {});
    });
  });
});

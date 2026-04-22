import { describe, expect, it } from "bun:test";
import {
  applyTextDiff,
  canonicalizeOps,
  composeTextDiffs,
  computeTextDiff,
  inverseTextDiff,
  transformTextDiffs,
  type TextDiffOp,
} from "./text-diff.ts";

describe("text-diff", () => {
  describe("computeTextDiff", () => {
    const check = (before: string, after: string, expected: TextDiffOp[]) => {
      expect(computeTextDiff(before, after)).toEqual(expected);
    };

    it("returns empty ops for identical strings", () => {
      check("hello", "hello", []);
    });

    it("returns empty ops for two empty strings", () => {
      check("", "", []);
    });

    it("diffs empty to value", () => {
      check("", "hello", [["insert", "hello"]]);
    });

    it("diffs value to empty", () => {
      check("hello", "", [["delete", "hello"]]);
    });

    it("diffs single-char typo", () => {
      check("hello", "hallo", [
        ["retain", 1],
        ["delete", "e"],
        ["insert", "a"],
      ]);
    });

    it("diffs word replacement", () => {
      check("the cat sat", "the dog sat", [
        ["retain", 4],
        ["delete", "cat"],
        ["insert", "dog"],
      ]);
    });

    // ï is U+00EF, single UTF-16 code unit
    it("diffs Unicode BMP characters", () => {
      check("naïve", "naive", [
        ["retain", 2],
        ["delete", "ï"],
        ["insert", "i"],
      ]);
    });

    // Emoji are surrogate pairs: 2 UTF-16 code units each
    it("diffs surrogate pairs", () => {
      check("hello 😀", "hello 🌍", [
        ["retain", 6],
        ["delete", "😀"],
        ["insert", "🌍"],
      ]);
    });

    it("diffs full rewrite with no common characters", () => {
      check("abc", "xyz", [
        ["delete", "abc"],
        ["insert", "xyz"],
      ]);
    });

    it("handles insert in the middle", () => {
      check("abcd", "abXXcd", [
        ["retain", 2],
        ["insert", "XX"],
      ]);
    });

    it("handles delete in the middle", () => {
      check("abXXcd", "abcd", [
        ["retain", 2],
        ["delete", "XX"],
      ]);
    });

    it("handles multiple edits", () => {
      check("abc def ghi", "ABC def GHI", [
        ["delete", "abc"],
        ["insert", "ABC"],
        ["retain", 5],
        ["delete", "ghi"],
        ["insert", "GHI"],
      ]);
    });
  });

  describe("canonicalizeOps", () => {
    const check = (input: TextDiffOp[], expected: TextDiffOp[]) => {
      expect(canonicalizeOps(input)).toEqual(expected);
    };

    it("returns empty array unchanged", () => {
      check([], []);
    });

    it("drops empty ops", () => {
      check(
        [
          ["retain", 0],
          ["insert", ""],
          ["retain", 3],
          ["delete", ""],
        ],
        [],
      );
    });

    it("drops trailing retain", () => {
      check(
        [
          ["insert", "x"],
          ["retain", 5],
        ],
        [["insert", "x"]],
      );
    });

    it("drops sole retain", () => {
      check([["retain", 5]], []);
    });

    it("merges adjacent same-kind ops", () => {
      check(
        [
          ["retain", 2],
          ["retain", 3],
          ["insert", "a"],
          ["insert", "b"],
          ["delete", "x"],
          ["delete", "y"],
        ],
        [
          ["retain", 5],
          ["delete", "xy"],
          ["insert", "ab"],
        ],
      );
    });

    it("reorders insert-delete to delete-insert", () => {
      check(
        [
          ["insert", "new"],
          ["delete", "old"],
        ],
        [
          ["delete", "old"],
          ["insert", "new"],
        ],
      );
    });
  });

  describe("applyTextDiff", () => {
    const check = (base: string, ops: TextDiffOp[], expected: string) => {
      expect(applyTextDiff(base, ops)).toBe(expected);
    };

    it("applies empty ops as identity", () => {
      check("hello", [], "hello");
    });

    it("applies empty ops to empty string", () => {
      check("", [], "");
    });

    it("applies pure insert to empty string", () => {
      check("", [["insert", "hello"]], "hello");
    });

    it("applies pure delete to matching string", () => {
      check("hello", [["delete", "hello"]], "");
    });

    it("applies retain + delete + insert", () => {
      check(
        "the cat sat",
        [
          ["retain", 4],
          ["delete", "cat"],
          ["insert", "dog"],
        ],
        "the dog sat",
      );
    });

    it("implicitly retains content after last op", () => {
      check(
        "abcde",
        [
          ["delete", "a"],
          ["insert", "A"],
        ],
        "Abcde",
      );
    });

    it("throws on delete mismatch", () => {
      expect(() => applyTextDiff("hello", [["delete", "world"]])).toThrow();
    });

    it("throws on retain overflow", () => {
      expect(() => applyTextDiff("hi", [["retain", 10]])).toThrow();
    });

    it("correctly applies all canonical diff cases", () => {
      for (const [before, after] of canonicalDiffCases) {
        const ops = computeTextDiff(before, after);
        check(before, ops, after);
      }
    });
  });

  describe("inverseTextDiff", () => {
    const check = (input: TextDiffOp[], expected: TextDiffOp[]) => {
      expect(inverseTextDiff(input)).toEqual(expected);
    };

    it("inverts empty ops", () => {
      check([], []);
    });

    it("inverts insert to delete", () => {
      check([["insert", "hello"]], [["delete", "hello"]]);
    });

    it("inverts delete to insert", () => {
      check([["delete", "hello"]], [["insert", "hello"]]);
    });

    it("preserves retain and swaps insert/delete", () => {
      check(
        [
          ["retain", 3],
          ["delete", "old"],
          ["insert", "new"],
        ],
        [
          ["retain", 3],
          ["delete", "new"],
          ["insert", "old"],
        ],
      );
    });

    it("produces canonical form (delete before insert)", () => {
      check(
        [
          ["delete", "a"],
          ["insert", "b"],
        ],
        [
          ["delete", "b"],
          ["insert", "a"],
        ],
      );
    });

    it("round-trips all canonical diff cases", () => {
      for (const [before, after] of canonicalDiffCases) {
        const ops = computeTextDiff(before, after);
        expect(applyTextDiff(before, ops)).toBe(after);
        expect(applyTextDiff(after, inverseTextDiff(ops))).toBe(before);
      }
    });
  });

  describe("composeTextDiffs", () => {
    // Property: apply(base, compose(a, b)) === apply(apply(base, a), b)
    const check = (base: string, mid: string, result: string) => {
      const a = computeTextDiff(base, mid);
      const b = computeTextDiff(mid, result);
      const c = composeTextDiffs(a, b);
      expect(applyTextDiff(base, c)).toBe(result);
    };

    it("composes two empty diffs", () => {
      expect(composeTextDiffs([], [])).toEqual([]);
    });

    it("composes sequential inserts", () => {
      check("", "hello", "hello world");
    });

    it("composes sequential deletes", () => {
      check("hello world", "hello", "");
    });

    it("cancels insert then delete", () => {
      // insert "X" then delete the same "X"
      const a: TextDiffOp[] = [
        ["retain", 1],
        ["insert", "X"],
      ];
      const b: TextDiffOp[] = [
        ["retain", 1],
        ["delete", "X"],
      ];
      expect(composeTextDiffs(a, b)).toEqual([]);
    });

    it("composes edits on different regions", () => {
      check("hello world", "HELLO world", "HELLO WORLD");
    });

    it("composes overlapping edits", () => {
      check("the cat sat", "the dog sat", "the dog ran");
    });

    it("composes insert followed by insert in new region", () => {
      check("abc", "aXbc", "aXYbc");
    });

    it("composes delete followed by insert elsewhere", () => {
      check("abcdef", "acdef", "acXdef");
    });

    it("throws on inconsistent payloads", () => {
      const a: TextDiffOp[] = [["insert", "abc"]];
      const b: TextDiffOp[] = [["delete", "xyz"]];
      expect(() => composeTextDiffs(a, b)).toThrow();
    });
  });

  describe("transformTextDiffs", () => {
    // Property: apply(apply(base, a), transform(a, b)) preserves both edits.
    // For non-conflicting edits this also equals
    // apply(apply(base, b), transform(b, a)) (convergence).
    it("transforms empty diffs", () => {
      expect(transformTextDiffs([], [])).toEqual([]);
    });

    it("transforms non-overlapping edits at different positions", () => {
      const base = "hello world";
      const a = computeTextDiff(base, "HELLO world"); // edit start
      const b = computeTextDiff(base, "hello WORLD"); // edit end
      const bPrime = transformTextDiffs(a, b);
      const aPrime = transformTextDiffs(b, a);
      expect(applyTextDiff(applyTextDiff(base, a), bPrime)).toBe("HELLO WORLD");
      expect(applyTextDiff(applyTextDiff(base, b), aPrime)).toBe("HELLO WORLD");
    });

    it("transforms concurrent inserts at same position (a wins placement)", () => {
      const base = "ab";
      const a: TextDiffOp[] = [
        ["retain", 1],
        ["insert", "X"],
      ];
      const b: TextDiffOp[] = [
        ["retain", 1],
        ["insert", "Y"],
      ];
      const bPrime = transformTextDiffs(a, b);
      // a applied: "aXb"; b' inserts Y after a's X → "aXYb"
      expect(applyTextDiff(applyTextDiff(base, a), bPrime)).toBe("aXYb");
    });

    it("drops b's retain when a deleted the same chars", () => {
      const base = "abc";
      const a: TextDiffOp[] = [["delete", "a"]]; // delete first
      const b: TextDiffOp[] = [
        ["retain", 2],
        ["delete", "c"],
      ]; // delete last
      const bPrime = transformTextDiffs(a, b);
      expect(applyTextDiff(applyTextDiff(base, a), bPrime)).toBe("b");
    });

    it("preserves b's delete when a retained the same chars", () => {
      const base = "abc";
      const a: TextDiffOp[] = [
        ["retain", 2],
        ["insert", "X"],
      ];
      const b: TextDiffOp[] = [["delete", "a"]];
      const bPrime = transformTextDiffs(a, b);
      // apply a: "abXc"; apply b': delete 'a' → "bXc"
      expect(applyTextDiff(applyTextDiff(base, a), bPrime)).toBe("bXc");
    });

    it("throws on overlapping deletes", () => {
      const base = "hello";
      const a = computeTextDiff(base, "ho"); // delete "ell"
      const b = computeTextDiff(base, "he"); // delete "llo"
      expect(() => transformTextDiffs(a, b)).toThrow();
    });
  });
});

// Pairs used by apply and inverse to verify behavior across representative edits
const canonicalDiffCases: [string, string][] = [
  ["", "hello"],
  ["hello", ""],
  ["hello", "hallo"],
  ["the cat sat", "the dog sat"],
  ["naïve", "naive"],
  ["hello 😀", "hello 🌍"],
  ["abc", "xyz"],
];

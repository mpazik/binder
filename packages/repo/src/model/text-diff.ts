import {
  diff as dmpDiff,
  DIFF_EQUAL,
  DIFF_INSERT,
  type Diff as DmpDiff,
} from "diff-match-patch-es";
import { assertFailed } from "@binder/utils";

// --- Types ---

export type TextRetainOp = [kind: "retain", length: number];
export type TextInsertOp = [kind: "insert", text: string];
export type TextDeleteOp = [kind: "delete", text: string];
export type TextDiffOp = TextRetainOp | TextInsertOp | TextDeleteOp;

// --- Type guards ---

export const isRetainOp = (op: TextDiffOp): op is TextRetainOp =>
  op[0] === "retain";
export const isInsertOp = (op: TextDiffOp): op is TextInsertOp =>
  op[0] === "insert";
export const isDeleteOp = (op: TextDiffOp): op is TextDeleteOp =>
  op[0] === "delete";

// --- Internal helpers ---

/** Convert diff-match-patch tuples to our op format. */
const fromDmpDiffs = (diffs: DmpDiff[]): TextDiffOp[] =>
  diffs.map((d): TextDiffOp => {
    if (d[0] === DIFF_EQUAL) return ["retain", d[1].length];
    if (d[0] === DIFF_INSERT) return ["insert", d[1]];
    return ["delete", d[1]];
  });

const isEmpty = (op: TextDiffOp): boolean =>
  isRetainOp(op) ? op[1] === 0 : op[1].length === 0;

/**
 * True if the ops describe no actual change — empty or only retain ops.
 * Used to skip storing changes that would be indistinguishable from
 * "no edit" after being applied to any base string.
 */
export const isTextDiffNoop = (ops: TextDiffOp[]): boolean =>
  ops.every((op) => isRetainOp(op) || isEmpty(op));

/** Merge two adjacent ops of the same kind into one. */
const mergeOp = (a: TextDiffOp, b: TextDiffOp): TextDiffOp => {
  if (isRetainOp(a) && isRetainOp(b)) return ["retain", a[1] + b[1]];
  if (isInsertOp(a) && isInsertOp(b)) return ["insert", a[1] + b[1]];
  if (isDeleteOp(a) && isDeleteOp(b)) return ["delete", a[1] + b[1]];
  assertFailed("Cannot merge ops of different kinds");
};

/** Length an op consumes from its input stream. */
const opLength = (op: TextDiffOp): number =>
  isRetainOp(op) ? op[1] : op[1].length;

/** Split an op into [head of length n, tail]. */
const sliceOp = (op: TextDiffOp, n: number): [TextDiffOp, TextDiffOp] => {
  if (isRetainOp(op))
    return [
      ["retain", n],
      ["retain", op[1] - n],
    ];
  return [
    [op[0], op[1].slice(0, n)],
    [op[0], op[1].slice(n)],
  ];
};

// --- Public API ---

/** Split (delete D, insert I) pairs by common prefix/suffix into retain chunks. */
const splitCommonAffixes = (ops: TextDiffOp[]): TextDiffOp[] => {
  const result: TextDiffOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const next = ops[i + 1];
    if (isDeleteOp(op) && next && isInsertOp(next)) {
      const d = op[1];
      const ins = next[1];
      let p = 0;
      while (p < d.length && p < ins.length && d[p] === ins[p]) p++;
      let s = 0;
      while (
        s < d.length - p &&
        s < ins.length - p &&
        d[d.length - 1 - s] === ins[ins.length - 1 - s]
      )
        s++;

      if (p > 0) result.push(["retain", p]);
      const dMid = d.slice(p, d.length - s);
      const iMid = ins.slice(p, ins.length - s);
      if (dMid.length > 0) result.push(["delete", dMid]);
      if (iMid.length > 0) result.push(["insert", iMid]);
      if (s > 0) result.push(["retain", s]);
      i++; // skip the consumed insert
    } else {
      result.push(op);
    }
  }
  return result;
};

/** Merge adjacent ops of the same kind in place. */
const mergeAdjacent = (ops: TextDiffOp[]): TextDiffOp[] => {
  const merged: TextDiffOp[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last[0] === op[0]) {
      merged[merged.length - 1] = mergeOp(last, op);
    } else {
      merged.push(op);
    }
  }
  return merged;
};

/**
 * Canonicalize diff ops to a byte-identical normal form:
 * 1. Drop empty ops (retain 0, insert "", delete "")
 * 2. Reorder adjacent insert+delete so delete comes first
 * 3. Merge adjacent same-kind ops
 * 4. Cancel common prefix/suffix between adjacent delete+insert pairs
 * 5. Merge adjacent same-kind ops again (affix splitting may create retains)
 * 6. Drop trailing retain
 */
export const canonicalizeOps = (ops: TextDiffOp[]): TextDiffOp[] => {
  if (ops.length === 0) return ops;

  const work = ops.filter((op) => !isEmpty(op));

  // Bubble-swap adjacent (insert, delete) → (delete, insert)
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < work.length - 1; i++) {
      if (isInsertOp(work[i]!) && isDeleteOp(work[i + 1]!)) {
        [work[i], work[i + 1]] = [work[i + 1]!, work[i]!];
        swapped = true;
      }
    }
  }

  const merged = mergeAdjacent(work);
  const split = splitCommonAffixes(merged);
  const final = mergeAdjacent(split);

  if (final.length > 0 && isRetainOp(final[final.length - 1]!)) {
    final.pop();
  }

  return final;
};

/**
 * Compute a canonical text diff between two strings.
 * Uses Myers diff via diff-match-patch-es over UTF-16 code units.
 * Character-level only (no line-level pre-pass) for determinism.
 */
export const computeTextDiff = (
  before: string,
  after: string,
): TextDiffOp[] => {
  if (before === after) return [];
  const diffs = dmpDiff(before, after, { diffTimeout: 0 }, false);
  return canonicalizeOps(fromDmpDiffs(diffs));
};

/**
 * Apply a text diff to a base string.
 * Verifies that delete payloads match the base content.
 * Content after the last op is implicitly retained.
 */
export const applyTextDiff = (base: string, ops: TextDiffOp[]): string => {
  let pos = 0;
  const parts: string[] = [];

  for (const op of ops) {
    if (isRetainOp(op)) {
      const end = pos + op[1];
      if (end > base.length) {
        assertFailed(
          `Retain overflows: retain ${op[1]} at position ${pos}, base length ${base.length}`,
        );
      }
      parts.push(base.slice(pos, end));
      pos = end;
    } else if (isInsertOp(op)) {
      parts.push(op[1]);
    } else {
      const text = op[1];
      const actual = base.slice(pos, pos + text.length);
      if (actual !== text) {
        assertFailed(
          `Delete mismatch at position ${pos}: expected "${text}", got "${actual}"`,
        );
      }
      pos += text.length;
    }
  }

  // Implicitly retain remaining content
  if (pos < base.length) {
    parts.push(base.slice(pos));
  }

  return parts.join("");
};

/**
 * Compute the inverse of a text diff.
 * Swaps insert and delete; retain unchanged.
 * Result is canonicalized (delete-before-insert ordering).
 *
 * Round-trip: applyTextDiff(applyTextDiff(base, ops), inverseTextDiff(ops)) === base
 */
export const inverseTextDiff = (ops: TextDiffOp[]): TextDiffOp[] =>
  canonicalizeOps(
    ops.map((op): TextDiffOp => {
      if (isRetainOp(op)) return op;
      if (isInsertOp(op)) return ["delete", op[1]];
      return ["insert", op[1]];
    }),
  );

/**
 * Compose two sequential diffs into one.
 * Given apply(base, a) = mid and apply(mid, b) = result,
 * returns c such that apply(base, c) = result.
 */
export const composeTextDiffs = (
  a: TextDiffOp[],
  b: TextDiffOp[],
): TextDiffOp[] => {
  const result: TextDiffOp[] = [];
  let i = 0;
  let j = 0;
  let aCur: TextDiffOp | null = null;
  let bCur: TextDiffOp | null = null;

  while (true) {
    if (!aCur && i < a.length) aCur = a[i++]!;
    if (!bCur && j < b.length) bCur = b[j++]!;
    if (!aCur && !bCur) break;

    // a.delete flows straight through: chars were in base, gone from mid,
    // so b never sees them.
    if (aCur && isDeleteOp(aCur)) {
      result.push(aCur);
      aCur = null;
      continue;
    }

    // b.insert flows straight through: new chars b adds that weren't in mid.
    if (bCur && isInsertOp(bCur)) {
      result.push(bCur);
      bCur = null;
      continue;
    }

    // a exhausted: treat as implicit retain; b's op carries through.
    if (!aCur) {
      result.push(bCur!);
      bCur = null;
      continue;
    }
    // b exhausted: treat as implicit retain; a's op carries through.
    if (!bCur) {
      result.push(aCur);
      aCur = null;
      continue;
    }

    // Both consume from mid. aCur is retain|insert, bCur is retain|delete.
    const n = Math.min(opLength(aCur), opLength(bCur));
    const [aHead, aTail] = sliceOp(aCur, n);
    const [bHead, bTail] = sliceOp(bCur, n);

    if (isRetainOp(aHead) && isRetainOp(bHead)) {
      result.push(["retain", n]);
    } else if (isRetainOp(aHead) && isDeleteOp(bHead)) {
      // a retained base chars, b deletes them from mid → delete from base.
      result.push(bHead);
    } else if (isInsertOp(aHead) && isRetainOp(bHead)) {
      result.push(aHead);
    } else if (isInsertOp(aHead) && isDeleteOp(bHead)) {
      // Cancel: a inserts then b deletes the same chars.
      if (aHead[1] !== bHead[1]) {
        assertFailed(
          `compose: insert/delete payload mismatch: "${aHead[1]}" vs "${bHead[1]}"`,
        );
      }
      // emit nothing
    }

    aCur = opLength(aTail) === 0 ? null : aTail;
    bCur = opLength(bTail) === 0 ? null : bTail;
  }

  return canonicalizeOps(result);
};

/**
 * Operational transform: given two diffs `a` and `b` against the same base,
 * return `b'` such that `apply(apply(base, a), b')` preserves both edits.
 *
 * `a` takes priority for concurrent inserts at the same position.
 * Throws on overlapping deletes (conflict).
 */
export const transformTextDiffs = (
  a: TextDiffOp[],
  b: TextDiffOp[],
): TextDiffOp[] => {
  const result: TextDiffOp[] = [];
  let i = 0;
  let j = 0;
  let aCur: TextDiffOp | null = null;
  let bCur: TextDiffOp | null = null;

  while (true) {
    if (!aCur && i < a.length) aCur = a[i++]!;
    if (!bCur && j < b.length) bCur = b[j++]!;
    if (!aCur && !bCur) break;

    // a's inserts added chars to the document; b' must skip past them.
    if (aCur && isInsertOp(aCur)) {
      result.push(["retain", aCur[1].length]);
      aCur = null;
      continue;
    }

    // b's inserts stay as inserts in b'.
    if (bCur && isInsertOp(bCur)) {
      result.push(bCur);
      bCur = null;
      continue;
    }

    // a exhausted: treat as implicit retain; b's retain/delete carries through.
    if (!aCur) {
      result.push(bCur!);
      bCur = null;
      continue;
    }
    // b exhausted: implicit retain. a.retain → b' retain; a.delete → nothing.
    if (!bCur) {
      if (isRetainOp(aCur)) result.push(aCur);
      aCur = null;
      continue;
    }

    // Both consume from base. aCur is retain|delete, bCur is retain|delete.
    const n = Math.min(opLength(aCur), opLength(bCur));
    const [aHead, aTail] = sliceOp(aCur, n);
    const [bHead, bTail] = sliceOp(bCur, n);

    if (isRetainOp(aHead) && isRetainOp(bHead)) {
      result.push(["retain", n]);
    } else if (isRetainOp(aHead) && isDeleteOp(bHead)) {
      result.push(bHead);
    } else if (isDeleteOp(aHead) && isRetainOp(bHead)) {
      // a removed these chars, b can't retain what's gone → emit nothing.
    } else if (isDeleteOp(aHead) && isDeleteOp(bHead)) {
      assertFailed(
        `transform: overlapping deletes at length ${n} ("${aHead[1]}" vs "${bHead[1]}")`,
      );
    }

    aCur = opLength(aTail) === 0 ? null : aTail;
    bCur = opLength(bTail) === 0 ? null : bTail;
  }

  return canonicalizeOps(result);
};

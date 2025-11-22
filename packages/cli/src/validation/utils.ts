import type { LineCounter } from "yaml";
import type { ValidationRange } from "./types.ts";

export const offsetToPosition = (
  offset: number,
  lineCounter: LineCounter,
): { line: number; character: number } => {
  const lineStarts = lineCounter.lineStarts;

  let line = 0;
  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i]! > offset) {
      line = i - 1;
      break;
    }
  }

  if (
    line === 0 &&
    lineStarts.length > 1 &&
    offset >= lineStarts[lineStarts.length - 1]!
  ) {
    line = lineStarts.length - 1;
  }

  const lineStart = lineStarts[line] ?? 0;
  const character = offset - lineStart;

  return { line, character };
};

export const rangeToValidationRange = (
  range: [number, number, number],
  lineCounter: LineCounter,
): ValidationRange => {
  const start = offsetToPosition(range[0], lineCounter);
  const end = offsetToPosition(range[2], lineCounter);

  return { start, end };
};

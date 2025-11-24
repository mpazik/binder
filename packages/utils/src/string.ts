export type SimilarMatch = {
  value: string;
  similarity: number;
};

export const levenshteinSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i++) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  const distance = matrix[a.length]![b.length]!;
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
};

export const findSimilar = (
  list: string[],
  target: string,
  options?: { threshold?: number; max?: number },
): SimilarMatch[] => {
  const threshold = options?.threshold ?? 0.65;
  const max = options?.max;

  const matches = list
    .map((value) => ({
      value,
      similarity: levenshteinSimilarity(
        target.toLowerCase(),
        value.toLowerCase(),
      ),
    }))
    .filter((m) => m.similarity >= threshold)
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return a.value.localeCompare(b.value);
    });

  return max ? matches.slice(0, max) : matches;
};

export type SelectionArgs = {
  limit?: number;
  last?: number;
  skip?: number;
};

export const applySelection = <T>(items: T[], args: SelectionArgs): T[] => {
  const { limit, last, skip } = args;

  if (last !== undefined) {
    const start = Math.max(0, items.length - last);
    return items.slice(start);
  }

  const startIndex = skip ?? 0;
  const endIndex = limit !== undefined ? startIndex + limit : undefined;

  return items.slice(startIndex, endIndex);
};

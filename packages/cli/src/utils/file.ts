import picomatch from "picomatch";

export const sanitizeFilename = (value: string): string => {
  return value.replace(/[/\\:*?"<>|]/g, "-").trim();
};

export type MatchOptions = {
  exclude?: string[];
  include?: string[];
};

export const createPathMatcher = (
  options: MatchOptions,
): ((path: string) => boolean) => {
  const hasInclude = options.include && options.include.length > 0;
  const hasExclude = options.exclude && options.exclude.length > 0;

  if (!hasInclude && !hasExclude) return () => true;

  const isIncluded = hasInclude
    ? picomatch(options.include!, { dot: true })
    : () => true;
  const isExcluded = hasExclude
    ? picomatch(options.exclude!, { dot: true })
    : () => false;

  return (path) => isIncluded(path) && !isExcluded(path);
};

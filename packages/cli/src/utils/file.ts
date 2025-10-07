export const sanitizeFilename = (value: string): string => {
  return value.replace(/[/\\:*?"<>|]/g, "-").trim();
};

export const keyCodeToKeyName = (keyCode: string): string =>
  keyCode.startsWith("Key") ? keyCode.substring(3) : keyCode.toUpperCase();

export const keyNameTooltip = (shortCutKey: string): string =>
  `[${keyCodeToKeyName(shortCutKey)}]`;

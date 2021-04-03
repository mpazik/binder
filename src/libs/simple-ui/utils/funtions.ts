export const getTarget = (event: Event): HTMLElement =>
  event.target as HTMLElement;

export const focusElement = (element: HTMLElement): void => element.focus();

export const isKey = (key: string) => (event: KeyboardEvent): boolean =>
  event.code === key;

export const hasMetaKey = (event: KeyboardEvent): boolean => event.metaKey;

export const hasCtrlKey = (event: KeyboardEvent): boolean => event.ctrlKey;
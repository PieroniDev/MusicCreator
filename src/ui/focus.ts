/**
 * Which editor last received a pointer interaction; keyboard shortcuts that
 * edit content (delete, copy, transpose...) go to that editor only.
 */
let activeScope: string | null = null;

export function setActiveScope(scope: string | null): void {
  activeScope = scope;
}

export function getActiveScope(): string | null {
  return activeScope;
}

/** True when the user is typing in a form field, where shortcuts must not fire. */
export function isTyping(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

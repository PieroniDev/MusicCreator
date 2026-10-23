import { actions } from '../state/store';

let bounds: { w: number; h: number } | null = null;

/** Called by the workspace whenever it is resized. */
export function setWorkspaceBounds(w: number, h: number): void {
  bounds = { w, h };
}

/** Puts every window back into a layout that fits the workspace. */
export function resetLayout(): void {
  if (bounds) actions().resetLayout(bounds.w, bounds.h);
}

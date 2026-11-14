/**
 * What the Android back button (and Escape-like "go back" gestures) should
 * close first. Every open overlay — sheet, menu, photo viewer, settings page —
 * registers here; the newest one closes first. No DOM or Capacitor imports,
 * so it stays unit-testable.
 */
type Handler = () => void;

const stack: { id: number; run: Handler }[] = [];
let next = 0;

/** Register an overlay; returns an unregister function. Last registered closes first. */
export function pushBack(run: Handler): () => void {
  const id = next++;
  stack.push({ id, run });
  return () => {
    const i = stack.findIndex((h) => h.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the top overlay. False when nothing was open. */
export function popBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.run();
  return true;
}

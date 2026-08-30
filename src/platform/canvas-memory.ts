type CanvasBackingStore = {
  width: number;
  height: number;
};

export function releaseCanvasBackingStore(canvas: CanvasBackingStore | undefined): void {
  if (canvas === undefined) return;
  try {
    canvas.width = 1;
  } catch {
    // Cleanup is best-effort and must not mask the operation result.
  }
  try {
    canvas.height = 1;
  } catch {
    // Cleanup is best-effort and must not mask the operation result.
  }
}

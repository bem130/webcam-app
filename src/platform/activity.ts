export type ActivityTarget = Pick<Document, "addEventListener" | "removeEventListener">;

export function bindUserActivity(
  onActivity: () => void,
  target: ActivityTarget = document,
): () => void {
  const pointer = () => onActivity();
  const keyboard = () => onActivity();
  const wheel = () => onActivity();
  target.addEventListener("pointerdown", pointer, { capture: true, passive: true });
  target.addEventListener("keydown", keyboard, { capture: true });
  target.addEventListener("wheel", wheel, { capture: true, passive: true });
  return () => {
    target.removeEventListener("pointerdown", pointer, { capture: true });
    target.removeEventListener("keydown", keyboard, { capture: true });
    target.removeEventListener("wheel", wheel, { capture: true });
  };
}

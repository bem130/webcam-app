export type LifecycleCallbacks = Readonly<{
  onHidden: () => void;
  onVisible: () => void;
  onPageHide: () => void;
}>;

export function bindDocumentLifecycle(callbacks: LifecycleCallbacks): () => void {
  const visibility = () => {
    if (document.visibilityState === "hidden") callbacks.onHidden();
    else callbacks.onVisible();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", callbacks.onPageHide);
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", callbacks.onPageHide);
  };
}

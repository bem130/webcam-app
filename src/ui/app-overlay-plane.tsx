import { Fragment, type ComponentChildren } from "preact";

/** Normal-document overlays, ordered from back to front by render order. */
export const APP_OVERLAY_ORDER = ["feedback", "memoryWarning"] as const;

/** Keep empty while DOM order is sufficient. Add only semantic names, never numbers. */
export const GENERATED_Z_INDEX_LAYERS: readonly string[] = [];

type AppOverlay = (typeof APP_OVERLAY_ORDER)[number];
type AppOverlayPlaneProps = Readonly<Record<AppOverlay, ComponentChildren>>;

export function AppOverlayPlane(props: AppOverlayPlaneProps) {
  return (
    <div class="app-overlay-plane">
      {APP_OVERLAY_ORDER.map((overlay) => (
        <Fragment key={overlay}>{props[overlay]}</Fragment>
      ))}
    </div>
  );
}

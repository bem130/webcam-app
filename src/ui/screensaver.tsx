import { useLayoutEffect, useRef } from "preact/hooks";

type ScreensaverProps = Readonly<{
  onResume: () => void;
}>;

export function Screensaver({ onResume }: ScreensaverProps) {
  const overlayRef = useRef<HTMLButtonElement>(null);
  const resumeStartedRef = useRef(false);

  useLayoutEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const consumeAndResume = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    onResume();
  };

  return (
    <button
      ref={overlayRef}
      class="screensaver"
      type="button"
      aria-label="カメラを再開"
      aria-live="polite"
      onPointerDown={consumeAndResume}
      onKeyDown={consumeAndResume}
      onWheel={consumeAndResume}
      onClick={consumeAndResume}
    >
      <span class="eyebrow">CAMERA OFF</span>
      <span class="screensaver-title" role="heading" aria-level={1}>
        カメラを停止しました
      </span>
      <span class="screensaver-copy">
        操作がなかったため、カメラを解放しました。画面を操作すると再開します。
      </span>
    </button>
  );
}

import type { SuspensionReason } from "../core/idle";

type SuspendedViewProps = Readonly<{
  reason: SuspensionReason;
  onResume: () => void;
}>;

export function SuspendedView({ reason, onResume }: SuspendedViewProps) {
  const idle = reason === "idle";
  return (
    <section class="suspended-card material" aria-labelledby="camera-suspended-title">
      <p class="eyebrow">CAMERA OFF</p>
      <h1 id="camera-suspended-title">カメラを停止しました</h1>
      <p>
        {idle
          ? "操作がなかったため、カメラを解放しました。"
          : "アプリがバックグラウンドになったため、カメラを解放しました。"}
      </p>
      <button class="primary-button" type="button" onClick={onResume}>
        カメラを再開
      </button>
    </section>
  );
}

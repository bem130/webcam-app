type PermissionViewProps = Readonly<{
  busy: boolean;
  capabilityMessage: string | null;
  onStart: () => void;
}>;

export function PermissionView({ busy, capabilityMessage, onStart }: PermissionViewProps) {
  return (
    <section class="welcome material" aria-labelledby="welcome-title">
      <p class="eyebrow">PRIVATE CAMERA UTILITY</p>
      <h1 id="welcome-title">Camera Clipboard</h1>
      <p>撮影すると画像をClipboardへコピーします。画像はサーバーや端末の写真ライブラリへ保存しません。</p>
      <p class="privacy-note">履歴はこのタブを再読み込みするまでメモリだけに保持されます。コピー後の扱いは端末のClipboard設定に従います。</p>
      {capabilityMessage !== null && <p class="inline-error" role="alert">{capabilityMessage}</p>}
      <button class="primary-button" type="button" onClick={onStart} disabled={busy || capabilityMessage !== null}>
        {busy ? <><span class="spinner" aria-hidden="true" />カメラを開始中…</> : "カメラを開始"}
      </button>
    </section>
  );
}

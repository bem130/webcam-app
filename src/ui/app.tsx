import { useEffect, useRef, useState } from "preact/hooks";
import { beginCaptureAndCopy } from "../platform/capture";

type Status = "idle" | "requesting" | "streaming" | "capturing" | "copied" | "error";

function capabilityError(): string | null {
  if (!window.isSecureContext) return "安全な接続で開く必要があります。";
  if (!navigator.mediaDevices?.getUserMedia) return "このブラウザはカメラAPIに対応していません。";
  if (!navigator.mediaDevices.enumerateDevices) return "このブラウザではカメラを列挙できません。";
  if (!navigator.clipboard?.write || !("ClipboardItem" in globalThis)) {
    return "このブラウザは画像のClipboardコピーに対応していません。";
  }
  return null;
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState(capabilityError());
  const unsupported = message !== null && status === "idle";

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startCamera = async () => {
    setStatus("requesting");
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("streaming");
    } catch {
      setStatus("error");
      setMessage("カメラを開始できませんでした。権限と接続状態を確認してください。");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (video === null || status !== "streaming") return;
    setStatus("capturing");
    setMessage("画像を作成しています…");
    const operation = beginCaptureAndCopy(video);
    void Promise.all([operation.png, operation.clipboard]).then(
      () => {
        setStatus("copied");
        setMessage("Clipboardにコピーしました。");
        window.setTimeout(() => setStatus("streaming"), 1600);
      },
      () => {
        setStatus("streaming");
        setMessage("撮影またはClipboardへのコピーに失敗しました。");
      },
    );
  };

  return (
    <main class="app-shell">
      <video ref={videoRef} class="camera-preview" autoplay muted playsinline aria-hidden="true" />
      {status === "idle" || status === "requesting" || status === "error" ? (
        <section class="welcome" aria-labelledby="welcome-title">
          <h1 id="welcome-title">Camera Clipboard</h1>
          <p>撮影した画像をClipboardへコピーします。画像はサーバーや写真ライブラリへ保存しません。</p>
          {message && <p role={status === "error" ? "alert" : undefined}>{message}</p>}
          <button type="button" onClick={() => void startCamera()} disabled={unsupported || status === "requesting"}>
            {status === "requesting" ? "カメラを開始中…" : status === "error" ? "もう一度試す" : "カメラを開始"}
          </button>
        </section>
      ) : (
        <button class="shutter" type="button" aria-label="撮影してClipboardへコピー" onClick={capture} disabled={status === "capturing"}>
          <span />
        </button>
      )}
      <p class="status" role="status" aria-live="polite">{message}</p>
    </main>
  );
}


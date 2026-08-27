import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { chooseQuickSwapTarget } from "../core/camera-selection";
import type { CameraError } from "../core/errors";
import { historyByteLength, MEMORY_WARNING_BYTES } from "../core/history";
import {
  captureId,
  initialModel,
  type CameraId,
  type CaptureEntry,
  type CaptureId,
} from "../core/model";
import { none } from "../core/result";
import { update } from "../core/update";
import {
  currentCameraId,
  enumerateCameras,
  mapCameraError,
  requestInitialCamera,
  requestSpecificCamera,
  setStreamEnabled,
  stopStream,
} from "../platform/camera";
import { beginCaptureAndCopy } from "../platform/capture";
import { beginPngWrite, browserClipboardPort, PNG_MIME } from "../platform/clipboard";
import { bindDocumentLifecycle } from "../platform/lifecycle";
import { ObjectUrlRegistry } from "../platform/object-url-registry";
import { CameraView } from "./camera-view";
import { ConfirmDialog } from "./confirm-dialog";
import { ErrorView } from "./error-view";
import { HistoryPanel } from "./history-panel";
import { cameraErrorMessage, captureErrorMessage, clipboardErrorMessage } from "./messages.ja";
import { PermissionView } from "./permission-view";

type Feedback = Readonly<{ tone: "neutral" | "success" | "error" | "warning"; text: string }>;

export function App() {
  const [model, dispatch] = useReducer(update, initialModel);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCapture, setSelectedCapture] = useState<CaptureId | null>(null);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [memoryNoticeDismissed, setMemoryNoticeDismissed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const placeholderRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const switchTransactionRef = useRef(0);
  const thumbnailUrls = useMemo(() => new ObjectUrlRegistry(), []);
  const detailUrls = useMemo(() => new ObjectUrlRegistry(), []);
  const capabilityMessage = preflightMessage();

  const currentId =
    model.camera.tag === "streaming" ||
    model.camera.tag === "switching" ||
    model.camera.tag === "suspended"
      ? model.camera.current
      : none;
  const currentCamera =
    currentId.tag === "some"
      ? (model.cameras.find((camera) => camera.id === currentId.value) ?? null)
      : null;

  const attachStream = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (video === null) throw new Error("video-unavailable");
    streamRef.current = stream;
    stream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (streamRef.current === stream) {
          streamRef.current = null;
          dispatch({ type: "cameraFailed", error: { tag: "streamEnded" } });
        }
      },
      { once: true },
    );
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video);
  }, []);

  const startCamera = useCallback(async () => {
    if (capabilityMessage !== null) return;
    switchTransactionRef.current += 1;
    const transaction = switchTransactionRef.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    dispatch({ type: "cameraRequestStarted" });
    setFeedback(null);
    const result = await requestInitialCamera();
    if (transaction !== switchTransactionRef.current) {
      if (result.tag === "ok") stopStream(result.value);
      return;
    }
    if (result.tag === "err") {
      dispatch({ type: "cameraFailed", error: result.error });
      return;
    }
    try {
      await attachStream(result.value);
      const cameras = await enumerateCameras();
      dispatch({ type: "cameraStarted", current: currentCameraId(result.value), cameras });
    } catch (cause) {
      stopStream(result.value);
      streamRef.current = null;
      dispatch({ type: "cameraFailed", error: mapCameraError(cause) });
    }
  }, [attachStream, capabilityMessage]);

  const switchCamera = useCallback(
    async (target: CameraId) => {
      if (model.camera.tag !== "streaming") return;
      const oldId = model.camera.current.tag === "some" ? model.camera.current.value : null;
      if (target === oldId) {
        setCameraMenuOpen(false);
        return;
      }
      drawSwitchPlaceholder(videoRef.current, placeholderRef.current);
      dispatch({ type: "cameraSwitchStarted", target });
      setCameraMenuOpen(false);
      switchTransactionRef.current += 1;
      const transaction = switchTransactionRef.current;
      const oldStream = streamRef.current;
      streamRef.current = null;
      stopStream(oldStream);
      const requested = await requestSpecificCamera(target);
      if (transaction !== switchTransactionRef.current) {
        if (requested.tag === "ok") stopStream(requested.value);
        return;
      }
      if (requested.tag === "ok") {
        try {
          await attachStream(requested.value);
          const cameras = await enumerateCameras();
          dispatch({
            type: "cameraSwitched",
            previous: oldId,
            current: currentCameraId(requested.value) ?? target,
            cameras,
          });
          return;
        } catch {
          stopStream(requested.value);
          streamRef.current = null;
        }
      }

      if (oldId !== null) {
        const restored = await requestSpecificCamera(oldId);
        if (transaction !== switchTransactionRef.current) {
          if (restored.tag === "ok") stopStream(restored.value);
          return;
        }
        if (restored.tag === "ok") {
          try {
            await attachStream(restored.value);
            const cameras = await enumerateCameras();
            dispatch({ type: "cameraStarted", current: oldId, cameras });
            setFeedback({
              tone: "error",
              text: "選択したカメラへ切り替えられなかったため、元のカメラへ戻しました。",
            });
            return;
          } catch {
            stopStream(restored.value);
            streamRef.current = null;
          }
        }
      }
      const error: CameraError =
        requested.tag === "err" ? requested.error : { tag: "cameraUnavailable" };
      dispatch({ type: "cameraFailed", error });
    },
    [attachStream, model.camera],
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (video === null || model.camera.tag !== "streaming" || captureBusy) return;
    const captureCamera = model.camera.current;
    const id = captureId(crypto.randomUUID());
    const capturedAtEpochMs = Date.now();
    setCaptureBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 75);
    dispatch({ type: "copyStarted", captureId: id });
    const operation = beginCaptureAndCopy(video);

    void Promise.all([operation.encoded, operation.clipboard]).then(([encoded, clipboard]) => {
      setCaptureBusy(false);
      if (encoded.tag === "err") {
        dispatch({ type: "copyDismissed" });
        setFeedback({ tone: "error", text: captureErrorMessage(encoded.error) });
        return;
      }
      const entry: CaptureEntry = {
        id,
        capturedAtEpochMs,
        camera: captureCamera,
        widthPx: encoded.value.width,
        heightPx: encoded.value.height,
        png: encoded.value.png,
        thumbnail: encoded.value.thumbnail,
        byteLength: encoded.value.png.size,
      };
      dispatch({ type: "captureAdded", entry });
      if (clipboard.tag === "ok") {
        dispatch({ type: "copySucceeded", captureId: id });
        setFeedback({ tone: "success", text: "Clipboardにコピーしました。" });
      } else {
        dispatch({ type: "copyFailed", captureId: id, error: clipboard.error });
        setFeedback({ tone: "error", text: clipboardErrorMessage(clipboard.error) });
      }
    });
  }, [captureBusy, model.camera]);

  const recopy = useCallback((entry: CaptureEntry) => {
    dispatch({ type: "copyStarted", captureId: entry.id });
    const write = beginPngWrite(Promise.resolve(entry.png), browserClipboardPort());
    void write.then((result) => {
      if (result.tag === "ok") {
        dispatch({ type: "copySucceeded", captureId: entry.id });
        setFeedback({ tone: "success", text: "Clipboardに再コピーしました。" });
      } else {
        dispatch({ type: "copyFailed", captureId: entry.id, error: result.error });
        setFeedback({ tone: "error", text: clipboardErrorMessage(result.error) });
      }
    });
  }, []);

  const deleteCapture = useCallback(
    (id: CaptureId) => {
      thumbnailUrls.revoke(id);
      detailUrls.revoke(id);
      dispatch({ type: "captureRemoved", captureId: id });
      setSelectedCapture(null);
      setFeedback({ tone: "neutral", text: "履歴から削除しました。" });
    },
    [detailUrls, thumbnailUrls],
  );

  const clearHistory = useCallback(() => {
    thumbnailUrls.revokeAll();
    detailUrls.revokeAll();
    dispatch({ type: "historyCleared" });
    setSelectedCapture(null);
    setConfirmClear(false);
    setFeedback({ tone: "neutral", text: "すべての履歴を消去しました。" });
  }, [detailUrls, thumbnailUrls]);

  useEffect(
    () =>
      bindDocumentLifecycle({
        onHidden: () => {
          setStreamEnabled(streamRef.current, false);
          dispatch({ type: "cameraSuspended" });
        },
        onVisible: () => {
          const stream = streamRef.current;
          const live =
            stream?.getVideoTracks().some((track) => track.readyState === "live") ?? false;
          if (live) {
            setStreamEnabled(stream, true);
            dispatch({ type: "cameraResumed" });
          } else if (stream !== null) {
            streamRef.current = null;
            dispatch({ type: "cameraFailed", error: { tag: "streamEnded" } });
          }
        },
        onPageHide: () => {
          switchTransactionRef.current += 1;
          stopStream(streamRef.current);
          streamRef.current = null;
          thumbnailUrls.revokeAll();
          detailUrls.revokeAll();
        },
      }),
    [detailUrls, thumbnailUrls],
  );

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.addEventListener === undefined) return;
    const refresh = () => {
      void enumerateCameras().then((cameras) => {
        const activeStream = streamRef.current;
        const activeId = activeStream === null ? null : currentCameraId(activeStream);
        dispatch({ type: "devicesUpdated", cameras });
        if (activeId !== null && !cameras.some((camera) => camera.id === activeId)) {
          stopStream(streamRef.current);
          streamRef.current = null;
          dispatch({ type: "cameraFailed", error: { tag: "streamEnded" } });
        }
      });
    };
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  useEffect(
    () => () => {
      switchTransactionRef.current += 1;
      stopStream(streamRef.current);
      thumbnailUrls.revokeAll();
      detailUrls.revokeAll();
    },
    [detailUrls, thumbnailUrls],
  );

  const latest = model.history[0];
  const latestThumbnailUrl =
    latest === undefined ? null : thumbnailUrls.get(latest.id, latest.thumbnail);
  const showMemoryWarning =
    model.memoryWarningShown &&
    historyByteLength(model.history) > MEMORY_WARNING_BYTES &&
    !memoryNoticeDismissed;
  const cameraSurfaceVisible =
    model.camera.tag !== "awaitingStart" && model.camera.tag !== "blocked";

  return (
    <main class={`app-shell${historyOpen ? " history-is-open" : ""}`}>
      {cameraSurfaceVisible && (
        <CameraView
          videoRef={videoRef}
          placeholderRef={placeholderRef}
          cameraState={model.camera}
          cameras={model.cameras}
          currentCamera={currentCamera}
          menuOpen={cameraMenuOpen}
          historyCount={model.history.length}
          latestThumbnailUrl={latestThumbnailUrl}
          captureBusy={captureBusy}
          flash={flash}
          inactive={model.camera.tag === "requesting"}
          onToggleMenu={() => {
            if (!cameraMenuOpen) {
              void enumerateCameras().then((cameras) =>
                dispatch({ type: "devicesUpdated", cameras }),
              );
            }
            setCameraMenuOpen((open) => !open);
          }}
          onCloseMenu={() => setCameraMenuOpen(false)}
          onSelectCamera={(id) => void switchCamera(id)}
          onCapture={capture}
          onQuickSwap={() => {
            const target = chooseQuickSwapTarget(model.cameras, currentId, model.previousCamera);
            if (target.tag === "some") void switchCamera(target.value);
          }}
          onOpenHistory={() => {
            setSelectedCapture(null);
            setHistoryOpen(true);
          }}
        />
      )}

      {(model.camera.tag === "awaitingStart" || model.camera.tag === "requesting") && (
        <PermissionView
          busy={model.camera.tag === "requesting"}
          capabilityMessage={capabilityMessage}
          onStart={() => void startCamera()}
        />
      )}
      {model.camera.tag === "blocked" && (
        <ErrorView
          message={cameraErrorMessage(model.camera.error)}
          onRetry={() => void startCamera()}
        />
      )}

      {feedback !== null && (
        <div class={`status-pill status-pill--${feedback.tone}`} role="status" aria-live="polite">
          <span>{feedback.text}</span>
          <button
            type="button"
            aria-label="通知を閉じる"
            title="通知を閉じる"
            onClick={() => setFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {showMemoryWarning && (
        <aside class="memory-warning" role="status">
          <p>履歴が128 MiBを超えました。端末のメモリが少ない場合は履歴を消去してください。</p>
          <button type="button" onClick={() => setHistoryOpen(true)}>
            履歴を確認
          </button>
          <button
            type="button"
            aria-label="警告を閉じる"
            title="警告を閉じる"
            onClick={() => setMemoryNoticeDismissed(true)}
          >
            ×
          </button>
        </aside>
      )}

      <HistoryPanel
        open={historyOpen}
        entries={model.history}
        selected={selectedCapture}
        thumbnailUrl={(entry) => thumbnailUrls.get(entry.id, entry.thumbnail)}
        detailUrl={(entry) => detailUrls.get(entry.id, entry.png)}
        onClose={() => {
          setHistoryOpen(false);
          setSelectedCapture(null);
        }}
        onSelect={setSelectedCapture}
        onRecopy={recopy}
        onDelete={deleteCapture}
        onClear={() => setConfirmClear(true)}
      />
      <ConfirmDialog
        open={confirmClear}
        onCancel={() => setConfirmClear(false)}
        onConfirm={clearHistory}
      />
    </main>
  );
}

function preflightMessage(): string | null {
  if (!window.isSecureContext)
    return "安全な接続で開く必要があります。HTTPSのURLを使用してください。";
  if (navigator.mediaDevices?.getUserMedia === undefined)
    return "このブラウザはカメラAPIに対応していません。";
  if (navigator.mediaDevices.enumerateDevices === undefined)
    return "このブラウザではカメラを列挙できません。";
  if (navigator.clipboard?.write === undefined || !("ClipboardItem" in globalThis)) {
    return "このブラウザは画像のClipboardコピーに対応していません。";
  }
  const clipboardItem = ClipboardItem as typeof ClipboardItem & {
    supports?: (type: string) => boolean;
  };
  if (clipboardItem.supports?.(PNG_MIME) === false)
    return "このブラウザはPNGのClipboardコピーに対応していません。";
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return "このブラウザでは画像を作成できません。";
  return null;
}

function drawSwitchPlaceholder(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): void {
  if (video === null || canvas === null || video.videoWidth === 0 || video.videoHeight === 0)
    return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error("frame-timeout"))), 5000);
    const ready = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish(resolve);
    };
    const finish = (complete: () => void) => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("canplay", ready);
      complete();
    };
    video.addEventListener("loadeddata", ready);
    video.addEventListener("canplay", ready);
  });
}

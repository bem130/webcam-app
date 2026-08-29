import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import {
  attachCameraStream,
  clearSwitchPlaceholder,
  drawSwitchPlaceholder,
  hardStopCameraStream,
} from "../application/camera-session";
import {
  observeCaptureOperation,
  type CaptureLifecycleEvent,
} from "../application/capture-controller";
import { createIdleController } from "../application/idle-controller";
import { chooseQuickSwapTarget } from "../core/camera-selection";
import type { CameraError } from "../core/errors";
import { historyByteLength, MEMORY_WARNING_BYTES } from "../core/history";
import type { SuspensionReason } from "../core/idle";
import {
  captureId,
  emptyCaptureDiagnostics,
  initialModel,
  type CameraId,
  type CaptureDiagnostics,
  type CaptureEntry,
  type CaptureId,
} from "../core/model";
import { none, type Option } from "../core/result";
import { update } from "../core/update";
import {
  currentCameraId,
  enumerateCameras,
  mapCameraError,
  requestInitialCamera,
  requestSpecificCamera,
  stopStream,
} from "../platform/camera";
import { bindUserActivity } from "../platform/activity";
import { beginCaptureAndCopy, beginCapturedImageCopy } from "../platform/capture";
import { PNG_MIME } from "../platform/clipboard";
import { browserImageProcessingPort } from "../platform/image-processing";
import { bindDocumentLifecycle } from "../platform/lifecycle";
import { ObjectUrlRegistry } from "../platform/object-url-registry";
import { AppOverlayPlane } from "./app-overlay-plane";
import { discoverNativePhotoCapture, type NativePhotoCapture } from "../platform/native-photo";
import { CameraView } from "./camera-view";
import { ConfirmDialog } from "./confirm-dialog";
import { ErrorView } from "./error-view";
import { HistoryPanel } from "./history-panel";
import { cameraErrorMessage, captureErrorMessage, clipboardErrorMessage } from "./messages.ja";
import { PermissionView } from "./permission-view";
import { SuspendedView } from "./suspended-view";

type Feedback = Readonly<{ tone: "neutral" | "success" | "error" | "warning"; text: string }>;
const TRANSIENT_FEEDBACK_DURATION_MS = 3_000;

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
  const [captureDiagnostics, setCaptureDiagnostics] = useState<
    ReadonlyMap<CaptureId, CaptureDiagnostics>
  >(new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const placeholderRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativePhotoRef = useRef<Option<NativePhotoCapture>>(none);
  const ignoredDiagnosticsRef = useRef(new Set<CaptureId>());
  const switchTransactionRef = useRef(0);
  const cameraRequestInFlightRef = useRef(false);
  const cameraRequestTargetRef = useRef<Option<CameraId>>(none);
  const modelRef = useRef(model);
  modelRef.current = model;
  const thumbnailUrls = useMemo(() => new ObjectUrlRegistry(), []);
  const detailUrls = useMemo(() => new ObjectUrlRegistry(), []);
  const imageProcessing = useMemo(
    () => browserImageProcessingPort(diagnosticVideoFramePipeline(window.location.search)),
    [],
  );
  const capabilityMessage = preflightMessage();

  useEffect(() => {
    if (feedback === null || (feedback.tone !== "success" && feedback.tone !== "neutral")) {
      return;
    }
    const visibleFeedback = feedback;
    const handle = window.setTimeout(() => {
      setFeedback((current) => (current === visibleFeedback ? null : current));
    }, TRANSIENT_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(handle);
  }, [feedback]);

  const hardSuspendCamera = useCallback((reason: SuspensionReason) => {
    const camera = modelRef.current.camera;
    if (
      streamRef.current === null &&
      camera.tag !== "streaming" &&
      camera.tag !== "switching" &&
      camera.tag !== "requesting"
    ) {
      return;
    }
    const stream = streamRef.current;
    const streamCamera = hardStopCameraStream(videoRef.current, stream);
    const retainedCamera =
      streamCamera.tag === "some"
        ? streamCamera
        : camera.tag === "streaming" || camera.tag === "switching"
          ? camera.current
          : camera.tag === "requesting"
            ? cameraRequestTargetRef.current
            : none;
    switchTransactionRef.current += 1;
    streamRef.current = null;
    nativePhotoRef.current = none;
    clearSwitchPlaceholder(placeholderRef.current);
    setCameraMenuOpen(false);
    dispatch({ type: "cameraSuspended", current: retainedCamera, reason });
  }, []);

  const idleController = useMemo(
    () =>
      createIdleController({
        onSuspend: () => hardSuspendCamera("idle"),
      }),
    [hardSuspendCamera],
  );

  const discoverPhotoCapabilities = useCallback((stream: MediaStream) => {
    nativePhotoRef.current = none;
    dispatch({ type: "photoCapabilityUpdated", capability: { tag: "checking" } });
    const track = stream.getVideoTracks()[0];
    void discoverNativePhotoCapture(track).then((nativePhoto) => {
      if (streamRef.current !== stream || track?.readyState !== "live") return;
      nativePhotoRef.current = nativePhoto;
      dispatch({
        type: "photoCapabilityUpdated",
        capability:
          nativePhoto.tag === "some"
            ? { tag: "supported", settings: nativePhoto.value.maximum }
            : { tag: "unsupported" },
      });
    });
  }, []);

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

  const attachStream = useCallback(
    async (stream: MediaStream) => {
      const video = videoRef.current;
      if (video === null) throw new Error("video-unavailable");
      streamRef.current = stream;
      return attachCameraStream(video, stream, () => {
        if (streamRef.current === stream) {
          streamRef.current = null;
          nativePhotoRef.current = none;
          idleController.cameraStopped();
          dispatch({ type: "cameraFailed", error: { tag: "streamEnded" } });
        }
      });
    },
    [idleController],
  );

  const startCamera = useCallback(async () => {
    if (capabilityMessage !== null || cameraRequestInFlightRef.current) return;
    cameraRequestInFlightRef.current = true;
    cameraRequestTargetRef.current = none;
    try {
      idleController.cameraStopped();
      switchTransactionRef.current += 1;
      const transaction = switchTransactionRef.current;
      stopStream(streamRef.current);
      streamRef.current = null;
      nativePhotoRef.current = none;
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
        const videoSettings = await attachStream(result.value);
        const cameras = await enumerateCameras();
        dispatch({
          type: "cameraStarted",
          current: currentCameraId(result.value),
          cameras,
          videoSettings,
        });
        discoverPhotoCapabilities(result.value);
        idleController.cameraStreaming();
      } catch (cause) {
        stopStream(result.value);
        streamRef.current = null;
        nativePhotoRef.current = none;
        dispatch({ type: "cameraFailed", error: mapCameraError(cause) });
      }
    } finally {
      cameraRequestInFlightRef.current = false;
      cameraRequestTargetRef.current = none;
    }
  }, [attachStream, capabilityMessage, discoverPhotoCapabilities, idleController]);

  const resumeCamera = useCallback(async () => {
    if (model.camera.tag !== "suspended" || cameraRequestInFlightRef.current) return;
    cameraRequestInFlightRef.current = true;
    const retainedCamera = model.camera.current;
    cameraRequestTargetRef.current = retainedCamera;
    try {
      switchTransactionRef.current += 1;
      const transaction = switchTransactionRef.current;
      dispatch({ type: "cameraRequestStarted" });
      setFeedback(null);
      const result =
        retainedCamera.tag === "some"
          ? await requestSpecificCamera(retainedCamera.value)
          : await requestInitialCamera();
      if (transaction !== switchTransactionRef.current) {
        if (result.tag === "ok") stopStream(result.value);
        return;
      }
      if (result.tag === "err") {
        dispatch({ type: "cameraFailed", error: result.error });
        return;
      }
      try {
        const videoSettings = await attachStream(result.value);
        const cameras = await enumerateCameras();
        dispatch({
          type: "cameraStarted",
          current: currentCameraId(result.value),
          cameras,
          videoSettings,
        });
        discoverPhotoCapabilities(result.value);
        idleController.cameraStreaming();
      } catch (cause) {
        stopStream(result.value);
        streamRef.current = null;
        nativePhotoRef.current = none;
        dispatch({ type: "cameraFailed", error: mapCameraError(cause) });
      }
    } finally {
      cameraRequestInFlightRef.current = false;
      cameraRequestTargetRef.current = none;
    }
  }, [attachStream, discoverPhotoCapabilities, idleController, model.camera]);

  const switchCamera = useCallback(
    async (target: CameraId) => {
      if (model.camera.tag !== "streaming" || captureBusy) return;
      const oldId = model.camera.current;
      if (oldId.tag === "some" && target === oldId.value) {
        setCameraMenuOpen(false);
        return;
      }
      drawSwitchPlaceholder(videoRef.current, placeholderRef.current);
      dispatch({ type: "cameraSwitchStarted", target });
      setCameraMenuOpen(false);
      idleController.cameraStopped();
      switchTransactionRef.current += 1;
      const transaction = switchTransactionRef.current;
      const oldStream = streamRef.current;
      streamRef.current = null;
      nativePhotoRef.current = none;
      stopStream(oldStream);
      const requested = await requestSpecificCamera(target);
      if (transaction !== switchTransactionRef.current) {
        if (requested.tag === "ok") stopStream(requested.value);
        return;
      }
      if (requested.tag === "ok") {
        try {
          const videoSettings = await attachStream(requested.value);
          const cameras = await enumerateCameras();
          const requestedId = currentCameraId(requested.value);
          clearSwitchPlaceholder(placeholderRef.current);
          dispatch({
            type: "cameraSwitched",
            previous: oldId,
            current: requestedId.tag === "some" ? requestedId.value : target,
            cameras,
            videoSettings,
          });
          discoverPhotoCapabilities(requested.value);
          idleController.cameraStreaming();
          return;
        } catch {
          stopStream(requested.value);
          streamRef.current = null;
          nativePhotoRef.current = none;
        }
      }

      if (oldId.tag === "some") {
        const restored = await requestSpecificCamera(oldId.value);
        if (transaction !== switchTransactionRef.current) {
          if (restored.tag === "ok") stopStream(restored.value);
          return;
        }
        if (restored.tag === "ok") {
          try {
            const videoSettings = await attachStream(restored.value);
            const cameras = await enumerateCameras();
            clearSwitchPlaceholder(placeholderRef.current);
            dispatch({ type: "cameraStarted", current: oldId, cameras, videoSettings });
            discoverPhotoCapabilities(restored.value);
            idleController.cameraStreaming();
            setFeedback({
              tone: "error",
              text: "選択したカメラへ切り替えられなかったため、元のカメラへ戻しました。",
            });
            return;
          } catch {
            stopStream(restored.value);
            streamRef.current = null;
            nativePhotoRef.current = none;
          }
        }
      }
      const error: CameraError =
        requested.tag === "err" ? requested.error : { tag: "cameraUnavailable" };
      clearSwitchPlaceholder(placeholderRef.current);
      dispatch({ type: "cameraFailed", error });
    },
    [attachStream, captureBusy, discoverPhotoCapabilities, idleController, model.camera],
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (video === null || model.camera.tag !== "streaming" || captureBusy) return;
    const captureCamera = model.camera.current;
    const id = captureId(crypto.randomUUID());
    ignoredDiagnosticsRef.current.delete(id);
    const capturedAtEpochMs = Date.now();
    setCaptureBusy(true);
    setCameraMenuOpen(false);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 75);
    dispatch({ type: "copyStarted", captureId: id });
    idleController.inhibit();
    const capturePreference = model.capturePreference;
    const operation = beginCaptureAndCopy(video, {
      imageProcessing,
      nativePhoto: nativePhotoRef.current,
      preference: capturePreference,
      observeTiming: (measurement) => {
        if (ignoredDiagnosticsRef.current.has(id)) return;
        setCaptureDiagnostics((current) => {
          const next = new Map(current);
          const diagnostics = current.get(id) ?? emptyCaptureDiagnostics;
          next.set(
            id,
            measurement.kind === "duration"
              ? {
                  ...diagnostics,
                  durations: {
                    ...diagnostics.durations,
                    [measurement.stage]: measurement.durationMs,
                  },
                }
              : {
                  ...diagnostics,
                  milestones: {
                    ...diagnostics.milestones,
                    [measurement.milestone]: measurement.offsetFromShutterMs,
                  },
                },
          );
          return next;
        });
      },
    });
    observeCaptureOperation(id, operation, (event: CaptureLifecycleEvent) => {
      switch (event.type) {
        case "cameraSourceSettled":
          idleController.release();
          break;
        case "captureSucceeded": {
          setCaptureDiagnostics((current) => {
            const next = new Map(current);
            const diagnostics = current.get(id) ?? emptyCaptureDiagnostics;
            next.set(
              id,
              event.image.route === "photo"
                ? {
                    ...diagnostics,
                    durations: {
                      ...diagnostics.durations,
                      videoFrameAcquire: diagnostics.durations.videoFrameAcquire ?? none,
                      videoFrameTransfer: diagnostics.durations.videoFrameTransfer ?? none,
                      videoFrameRaster: diagnostics.durations.videoFrameRaster ?? none,
                      videoFramePngEncode: diagnostics.durations.videoFramePngEncode ?? none,
                    },
                  }
                : {
                    ...diagnostics,
                    durations: {
                      ...diagnostics.durations,
                      sourceAcquisition: diagnostics.durations.sourceAcquisition ?? none,
                      imageDecode: diagnostics.durations.imageDecode ?? none,
                    },
                  },
            );
            return next;
          });
          const entry: CaptureEntry = {
            id,
            capturedAtEpochMs,
            camera: captureCamera,
            widthPx: event.image.width,
            heightPx: event.image.height,
            blob: event.image.blob,
            mimeType: event.image.mimeType,
            preference: capturePreference,
            route: event.image.route,
            thumbnail: none,
            byteLength: event.image.blob.size,
          };
          setCaptureBusy(false);
          dispatch({ type: "captureAdded", entry });
          break;
        }
        case "captureFailed":
          setCaptureBusy(false);
          ignoredDiagnosticsRef.current.add(event.captureId);
          setCaptureDiagnostics((current) => withoutMapKey(current, event.captureId));
          dispatch({ type: "copyDismissed" });
          setFeedback({ tone: "error", text: captureErrorMessage(event.error) });
          break;
        case "thumbnailSucceeded":
          dispatch({
            type: "captureThumbnailAdded",
            captureId: event.captureId,
            thumbnail: event.thumbnail,
          });
          break;
        case "clipboardSucceeded":
          dispatch({ type: "copySucceeded", captureId: event.captureId });
          setFeedback({ tone: "success", text: "Clipboardにコピーしました。" });
          break;
        case "clipboardFailed":
          dispatch({ type: "copyFailed", captureId: event.captureId, error: event.error });
          setFeedback({ tone: "error", text: clipboardErrorMessage(event.error) });
          break;
      }
    });
  }, [captureBusy, idleController, imageProcessing, model.camera, model.capturePreference]);

  const recopy = useCallback(
    (entry: CaptureEntry) => {
      dispatch({ type: "copyStarted", captureId: entry.id });
      const write = beginCapturedImageCopy(
        { blob: entry.blob, mimeType: entry.mimeType },
        { imageProcessing },
      );
      void write.then((result) => {
        if (result.tag === "ok") {
          dispatch({ type: "copySucceeded", captureId: entry.id });
          setFeedback({ tone: "success", text: "Clipboardに再コピーしました。" });
        } else {
          dispatch({ type: "copyFailed", captureId: entry.id, error: result.error });
          setFeedback({ tone: "error", text: clipboardErrorMessage(result.error) });
        }
      });
    },
    [imageProcessing],
  );

  const deleteCapture = useCallback(
    (id: CaptureId) => {
      thumbnailUrls.revoke(id);
      detailUrls.revoke(id);
      ignoredDiagnosticsRef.current.add(id);
      setCaptureDiagnostics((current) => withoutMapKey(current, id));
      dispatch({ type: "captureRemoved", captureId: id });
      setSelectedCapture(null);
      setFeedback({ tone: "neutral", text: "履歴から削除しました。" });
    },
    [detailUrls, thumbnailUrls],
  );

  const clearHistory = useCallback(() => {
    thumbnailUrls.revokeAll();
    detailUrls.revokeAll();
    model.history.forEach((entry) => ignoredDiagnosticsRef.current.add(entry.id));
    setCaptureDiagnostics(new Map());
    dispatch({ type: "historyCleared" });
    setSelectedCapture(null);
    setConfirmClear(false);
    setFeedback({ tone: "neutral", text: "すべての履歴を消去しました。" });
  }, [detailUrls, model.history, thumbnailUrls]);

  useEffect(
    () =>
      bindDocumentLifecycle({
        onHidden: () => {
          idleController.cameraStopped();
          hardSuspendCamera("background");
        },
        onVisible: () => undefined,
        onPageHide: () => {
          idleController.cameraStopped();
          switchTransactionRef.current += 1;
          hardStopCameraStream(videoRef.current, streamRef.current);
          streamRef.current = null;
          nativePhotoRef.current = none;
          thumbnailUrls.revokeAll();
          detailUrls.revokeAll();
        },
      }),
    [detailUrls, hardSuspendCamera, idleController, thumbnailUrls],
  );

  useEffect(() => bindUserActivity(() => idleController.activity()), [idleController]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.addEventListener === undefined) return;
    const refresh = () => {
      void enumerateCameras().then((cameras) => {
        const activeStream = streamRef.current;
        const activeId = activeStream === null ? none : currentCameraId(activeStream);
        dispatch({ type: "devicesUpdated", cameras });
        if (activeId.tag === "some" && !cameras.some((camera) => camera.id === activeId.value)) {
          stopStream(streamRef.current);
          streamRef.current = null;
          nativePhotoRef.current = none;
          idleController.cameraStopped();
          dispatch({ type: "cameraFailed", error: { tag: "streamEnded" } });
        }
      });
    };
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, [idleController]);

  useEffect(
    () => () => {
      switchTransactionRef.current += 1;
      idleController.dispose();
      hardStopCameraStream(videoRef.current, streamRef.current);
      streamRef.current = null;
      nativePhotoRef.current = none;
      imageProcessing.dispose();
      thumbnailUrls.revokeAll();
      detailUrls.revokeAll();
    },
    [detailUrls, idleController, imageProcessing, thumbnailUrls],
  );

  const latest = model.history[0];
  const latestThumbnailUrl =
    latest?.thumbnail.tag === "some" ? thumbnailUrls.get(latest.id, latest.thumbnail.value) : null;
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
          videoSettings={model.videoSettings.tag === "some" ? model.videoSettings.value : null}
          photoCapability={model.photoCapability}
          capturePreference={model.capturePreference}
          menuOpen={cameraMenuOpen}
          historyCount={model.history.length}
          latestThumbnailUrl={latestThumbnailUrl}
          captureBusy={captureBusy}
          flash={flash}
          inactive={model.camera.tag === "requesting" || model.camera.tag === "suspended"}
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
          onCapturePreferenceChange={(preference) =>
            dispatch({ type: "capturePreferenceChanged", preference })
          }
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
      {model.camera.tag === "suspended" && (
        <SuspendedView reason={model.camera.reason} onResume={() => void resumeCamera()} />
      )}

      <AppOverlayPlane
        feedback={
          feedback === null ? null : (
            <div
              class={`status-pill status-pill--${feedback.tone}`}
              role="status"
              aria-live="polite"
            >
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
          )
        }
        memoryWarning={
          showMemoryWarning ? (
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
          ) : null
        }
      />

      <HistoryPanel
        open={historyOpen}
        entries={model.history}
        selected={selectedCapture}
        thumbnailUrl={(entry) =>
          entry.thumbnail.tag === "some" ? thumbnailUrls.get(entry.id, entry.thumbnail.value) : null
        }
        detailUrl={(entry) => detailUrls.get(entry.id, entry.blob)}
        diagnostics={(entry) => captureDiagnostics.get(entry.id) ?? emptyCaptureDiagnostics}
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

function withoutMapKey<K, V>(source: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!source.has(key)) return source;
  const next = new Map(source);
  next.delete(key);
  return next;
}

function diagnosticVideoFramePipeline(search: string): "workerOffscreen2d" | "mainThreadCanvas" {
  return new URLSearchParams(search).get("videoFramePipeline") === "canvas"
    ? "mainThreadCanvas"
    : "workerOffscreen2d";
}

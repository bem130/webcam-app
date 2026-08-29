import type { RefObject } from "preact";
import { shouldMirrorPreview } from "../core/camera-selection";
import type {
  CameraDescriptor,
  CameraId,
  CameraState,
  CameraVideoSettings,
  CapturePreference,
  PhotoCapabilityState,
  PhotoCaptureSettings,
} from "../core/model";
import { CameraIcon, ChevronIcon, SwapIcon } from "./icons";

type CameraViewProps = Readonly<{
  videoRef: RefObject<HTMLVideoElement>;
  placeholderRef: RefObject<HTMLCanvasElement>;
  shutterRef: RefObject<HTMLButtonElement>;
  cameraState: CameraState;
  cameras: readonly CameraDescriptor[];
  currentCamera: CameraDescriptor | null;
  videoSettings: CameraVideoSettings | null;
  photoCapability: PhotoCapabilityState;
  capturePreference: CapturePreference;
  menuOpen: boolean;
  historyCount: number;
  latestThumbnailUrl: string | null;
  captureBusy: boolean;
  flash: boolean;
  inactive: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSelectCamera: (id: CameraId) => void;
  onCapture: () => void;
  onCapturePreferenceChange: (preference: CapturePreference) => void;
  onQuickSwap: () => void;
  onOpenHistory: () => void;
}>;

export function CameraView(props: CameraViewProps) {
  const {
    videoRef,
    placeholderRef,
    shutterRef,
    cameraState,
    cameras,
    currentCamera,
    videoSettings,
    photoCapability,
    capturePreference,
    menuOpen,
    historyCount,
    latestThumbnailUrl,
    captureBusy,
    flash,
    inactive,
    onToggleMenu,
    onCloseMenu,
    onSelectCamera,
    onCapture,
    onCapturePreferenceChange,
    onQuickSwap,
    onOpenHistory,
  } = props;
  const switching = cameraState.tag === "switching";
  const frontFacing = shouldMirrorPreview(currentCamera?.facing ?? "unknown");
  const photoSettings = photoCapability.tag === "supported" ? photoCapability.settings : null;

  return (
    <section
      class={`camera-stage${inactive ? " camera-stage--inactive" : ""}`}
      aria-label="カメラ画面"
      aria-hidden={inactive}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) onCloseMenu();
      }}
    >
      <video
        ref={videoRef}
        class={`camera-preview${frontFacing ? " camera-preview--mirrored" : ""}`}
        autoplay
        muted
        playsinline
        aria-hidden="true"
      />
      <canvas
        ref={placeholderRef}
        class={`switch-placeholder${switching ? " is-visible" : ""}`}
        aria-hidden="true"
      />
      {!inactive && (
        <header class="camera-topbar">
          <p class="camera-active material">
            <span aria-hidden="true" />
            カメラ使用中
          </p>
          {videoSettings !== null && (
            <p
              class="camera-quality material"
              aria-label={qualityLabel(videoSettings, photoSettings)}
            >
              <span>{photoSettings === null ? "プレビュー / 撮影" : "プレビュー"}</span>
              <strong>
                {videoSettings.widthPx} × {videoSettings.heightPx}
                {videoSettings.frameRate.tag === "none"
                  ? ""
                  : ` · ${formatFrameRate(videoSettings.frameRate.value)} fps`}
              </strong>
              {photoSettings !== null && (
                <>
                  <span>撮影 最大</span>
                  <strong>
                    {photoSettings.widthPx} × {photoSettings.heightPx}
                  </strong>
                </>
              )}
            </p>
          )}
          <label class="capture-preference material">
            <span>撮影方式</span>
            <select
              aria-label="撮影方式"
              value={photoCapability.tag === "supported" ? capturePreference : "videoFrame"}
              disabled={captureBusy}
              onChange={(event) =>
                onCapturePreferenceChange(
                  event.currentTarget.value === "photoPreferred" ? "photoPreferred" : "videoFrame",
                )
              }
            >
              <option value="photoPreferred" disabled={photoCapability.tag !== "supported"}>
                写真優先
              </option>
              <option value="videoFrame">動画フレーム</option>
            </select>
            {photoCapability.tag === "checking" && <small>写真APIを確認中です</small>}
            {photoCapability.tag === "unsupported" && (
              <small>このカメラでは写真APIを利用できません</small>
            )}
          </label>
          <div class="camera-menu-wrap">
            <button
              class="camera-selector material"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={captureBusy}
              onClick={onToggleMenu}
            >
              <CameraIcon />
              <span>{currentCamera?.label ?? "カメラ"}</span>
              <ChevronIcon />
            </button>
            {menuOpen && (
              <div class="camera-menu material" role="menu" aria-label="カメラを選択">
                {cameras.map((camera) => (
                  <button
                    key={camera.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={camera.id === currentCamera?.id}
                    onClick={() => onSelectCamera(camera.id)}
                  >
                    <span>{camera.label}</span>
                    {camera.id === currentCamera?.id && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
      )}

      {!inactive && (
        <footer class="camera-controls">
          <button
            class="round-control history-control material"
            type="button"
            aria-label={`履歴を開く（${historyCount}件）`}
            title="履歴を開く"
            onClick={onOpenHistory}
          >
            {latestThumbnailUrl === null ? <CameraIcon /> : <img src={latestThumbnailUrl} alt="" />}
            {historyCount > 0 && (
              <span class="count-badge" aria-hidden="true">
                {historyCount > 99 ? "99+" : historyCount}
              </span>
            )}
          </button>

          <button
            ref={shutterRef}
            class="shutter"
            type="button"
            aria-label="撮影してClipboardへコピー"
            title="撮影してClipboardへコピー"
            onClick={onCapture}
            disabled={captureBusy || switching}
          >
            {captureBusy ? (
              <span class="spinner spinner--dark" aria-hidden="true" />
            ) : (
              <span class="shutter-center" />
            )}
          </button>

          {cameras.length > 1 ? (
            <button
              class="round-control material"
              type="button"
              aria-label="別のカメラへすばやく切り替え"
              title="別のカメラへすばやく切り替え"
              onClick={onQuickSwap}
              disabled={captureBusy || switching}
            >
              <SwapIcon />
            </button>
          ) : (
            <span class="control-spacer" aria-hidden="true" />
          )}
        </footer>
      )}

      {switching && (
        <div class="switch-progress">
          <span class="spinner" aria-hidden="true" />
          <span class="sr-only">カメラを切り替えています</span>
        </div>
      )}
      <div class={`capture-flash${flash ? " is-visible" : ""}`} aria-hidden="true" />
    </section>
  );
}

function formatFrameRate(frameRate: number): string {
  return Number.isInteger(frameRate) ? String(frameRate) : frameRate.toFixed(1);
}

function qualityLabel(
  settings: CameraVideoSettings,
  photoSettings: PhotoCaptureSettings | null,
): string {
  const frameRate =
    settings.frameRate.tag === "none" ? "" : `、${formatFrameRate(settings.frameRate.value)} fps`;
  const preview = `プレビューの解像度 ${settings.widthPx} × ${settings.heightPx}${frameRate}`;
  return photoSettings === null
    ? `${preview}、撮影も同じ解像度`
    : `${preview}、撮影の最大解像度 ${photoSettings.widthPx} × ${photoSettings.heightPx}`;
}

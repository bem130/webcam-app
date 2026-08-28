import type { RefObject } from "preact";
import { shouldMirrorPreview } from "../core/camera-selection";
import type { CameraDescriptor, CameraId, CameraState, CameraVideoSettings } from "../core/model";
import { CameraIcon, ChevronIcon, SwapIcon } from "./icons";

type CameraViewProps = Readonly<{
  videoRef: RefObject<HTMLVideoElement>;
  placeholderRef: RefObject<HTMLCanvasElement>;
  cameraState: CameraState;
  cameras: readonly CameraDescriptor[];
  currentCamera: CameraDescriptor | null;
  videoSettings: CameraVideoSettings | null;
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
  onQuickSwap: () => void;
  onOpenHistory: () => void;
}>;

export function CameraView(props: CameraViewProps) {
  const {
    videoRef,
    placeholderRef,
    cameraState,
    cameras,
    currentCamera,
    videoSettings,
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
    onQuickSwap,
    onOpenHistory,
  } = props;
  const switching = cameraState.tag === "switching";
  const frontFacing = shouldMirrorPreview(currentCamera?.facing ?? "unknown");

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
      {switching && (
        <div class="switch-progress">
          <span class="spinner" aria-hidden="true" />
          <span class="sr-only">カメラを切り替えています</span>
        </div>
      )}
      <div class={`capture-flash${flash ? " is-visible" : ""}`} aria-hidden="true" />

      {!inactive && (
        <header class="camera-topbar">
          <div class="camera-menu-wrap">
            <button
              class="camera-selector material"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
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
          <p class="camera-active material">
            <span aria-hidden="true" />
            カメラ使用中
          </p>
          {videoSettings !== null && (
            <p class="camera-quality material" aria-label={qualityLabel(videoSettings)}>
              <span>プレビュー / 撮影</span>
              <strong>
                {videoSettings.widthPx} × {videoSettings.heightPx}
                {videoSettings.frameRate === null
                  ? ""
                  : ` · ${formatFrameRate(videoSettings.frameRate)} fps`}
              </strong>
            </p>
          )}
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
              disabled={switching}
            >
              <SwapIcon />
            </button>
          ) : (
            <span class="control-spacer" aria-hidden="true" />
          )}
        </footer>
      )}
    </section>
  );
}

function formatFrameRate(frameRate: number): string {
  return Number.isInteger(frameRate) ? String(frameRate) : frameRate.toFixed(1);
}

function qualityLabel(settings: CameraVideoSettings): string {
  const frameRate =
    settings.frameRate === null ? "" : `、${formatFrameRate(settings.frameRate)} fps`;
  return `プレビューと撮影の解像度 ${settings.widthPx} × ${settings.heightPx}${frameRate}`;
}

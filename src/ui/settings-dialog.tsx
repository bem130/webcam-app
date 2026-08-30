import { useLayoutEffect, useRef } from "preact/hooks";
import { IDLE_TIMEOUT_OPTIONS, type IdleTimeout } from "../core/idle";
import type { CapturePreference, PhotoCapabilityState } from "../core/model";
import { CloseIcon } from "./icons";

type SettingsDialogProps = Readonly<{
  open: boolean;
  idleTimeout: IdleTimeout;
  capturePreference: CapturePreference;
  photoCapability: PhotoCapabilityState;
  captureBusy: boolean;
  onClose: () => void;
  onIdleTimeoutChange: (timeout: IdleTimeout) => void;
  onCapturePreferenceChange: (preference: CapturePreference) => void;
}>;

const IDLE_TIMEOUT_LABELS: Readonly<Record<IdleTimeout, string>> = {
  "10s": "10秒",
  "30s": "30秒",
  "1m": "1分",
  "3m": "3分",
  "5m": "5分",
  "10m": "10分",
  off: "自動停止しない",
};

export function SettingsDialog(props: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { open, onClose } = props;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const photoSupported = props.photoCapability.tag === "supported";
  const effectiveCapturePreference = photoSupported ? props.capturePreference : "videoFrame";

  return (
    <dialog
      ref={dialogRef}
      class="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div class="settings-heading">
        <div>
          <p class="eyebrow">PREFERENCES</p>
          <h2 id="settings-title" ref={headingRef} tabIndex={-1}>
            設定
          </h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="設定を閉じる"
          title="設定を閉じる"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="settings-form">
        <label class="settings-field">
          <span>カメラ自動停止</span>
          <select
            aria-label="カメラ自動停止"
            value={props.idleTimeout}
            onChange={(event) => {
              const timeout = IDLE_TIMEOUT_OPTIONS.find(
                (candidate) => candidate === event.currentTarget.value,
              );
              if (timeout !== undefined) props.onIdleTimeoutChange(timeout);
            }}
          >
            {IDLE_TIMEOUT_OPTIONS.map((timeout) => (
              <option key={timeout} value={timeout}>
                {IDLE_TIMEOUT_LABELS[timeout]}
              </option>
            ))}
          </select>
          <small>操作がない間もcameraを使用し続ける時間です。</small>
        </label>

        <label class="settings-field">
          <span>撮影方式</span>
          <select
            aria-label="撮影方式"
            value={effectiveCapturePreference}
            disabled={props.captureBusy}
            onChange={(event) =>
              props.onCapturePreferenceChange(
                event.currentTarget.value === "photoPreferred" ? "photoPreferred" : "videoFrame",
              )
            }
          >
            <option value="photoPreferred" disabled={!photoSupported}>
              写真優先
            </option>
            <option value="videoFrame">動画フレーム</option>
          </select>
          {props.photoCapability.tag === "checking" && <small>写真APIを確認中です。</small>}
          {props.photoCapability.tag === "unsupported" && (
            <small>
              {props.capturePreference === "photoPreferred"
                ? "保存設定は写真優先です。このカメラでは動画フレームを使用します。"
                : "このカメラでは写真APIを利用できません。"}
            </small>
          )}
        </label>
      </div>
    </dialog>
  );
}

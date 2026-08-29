import { useEffect, useRef } from "preact/hooks";
import {
  browserClipboardDuration,
  type CaptureDiagnostics,
  type CaptureEntry,
  type CaptureId,
} from "../core/model";
import type { Option } from "../core/result";
import { CloseIcon, CopyIcon, TrashIcon } from "./icons";

type HistoryPanelProps = Readonly<{
  open: boolean;
  entries: readonly CaptureEntry[];
  selected: CaptureId | null;
  thumbnailUrl: (entry: CaptureEntry) => string | null;
  detailUrl: (entry: CaptureEntry) => string;
  diagnostics: (entry: CaptureEntry) => CaptureDiagnostics;
  onClose: () => void;
  onSelect: (id: CaptureId | null) => void;
  onRecopy: (entry: CaptureEntry) => void;
  onDelete: (id: CaptureId) => void;
  onClear: () => void;
}>;

export function HistoryPanel(props: HistoryPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const close = () => {
      if (open) onClose();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", close);
    };
  }, [onClose, open]);

  const selectedEntry = props.entries.find((entry) => entry.id === props.selected) ?? null;

  return (
    <dialog ref={dialogRef} class="history-dialog" aria-labelledby="history-title">
      <div class="history-heading">
        <div>
          <p class="eyebrow">THIS TAB ONLY</p>
          <h2 id="history-title" ref={headingRef} tabIndex={-1}>
            撮影履歴
          </h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="履歴を閉じる"
          title="履歴を閉じる"
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
      </div>

      {selectedEntry === null ? (
        <HistoryGrid {...props} />
      ) : (
        <CaptureDetail
          entry={selectedEntry}
          url={props.detailUrl(selectedEntry)}
          diagnostics={props.diagnostics(selectedEntry)}
          onBack={() => props.onSelect(null)}
          onRecopy={() => props.onRecopy(selectedEntry)}
          onDelete={() => props.onDelete(selectedEntry.id)}
        />
      )}
    </dialog>
  );
}

function HistoryGrid(props: HistoryPanelProps) {
  if (props.entries.length === 0) {
    return (
      <div class="empty-history">
        <span aria-hidden="true">▧</span>
        <p>このタブで撮影した画像がここに表示されます。</p>
      </div>
    );
  }
  return (
    <>
      <div class="history-grid" aria-label="撮影画像">
        {props.entries.map((entry) => {
          const thumbnailUrl = props.thumbnailUrl(entry);
          return (
            <button
              key={entry.id}
              class="history-item"
              type="button"
              onClick={() => props.onSelect(entry.id)}
            >
              {thumbnailUrl === null ? (
                <span class="history-thumbnail-pending" aria-label="プレビューを準備中">
                  …
                </span>
              ) : (
                <img
                  src={thumbnailUrl}
                  alt={`${formatTime(entry.capturedAtEpochMs)}に撮影した画像`}
                />
              )}
              <span>{formatTime(entry.capturedAtEpochMs)}</span>
              <small>
                {entry.widthPx} × {entry.heightPx} · {formatBytes(entry.byteLength)}
                {` · ${captureRouteLabel(entry.route)}`}
              </small>
            </button>
          );
        })}
      </div>
      <button class="clear-button" type="button" onClick={props.onClear}>
        <TrashIcon />
        すべて消去
      </button>
    </>
  );
}

type CaptureDetailProps = Readonly<{
  entry: CaptureEntry;
  url: string;
  diagnostics: CaptureDiagnostics;
  onBack: () => void;
  onRecopy: () => void;
  onDelete: () => void;
}>;

function CaptureDetail({
  entry,
  url,
  diagnostics,
  onBack,
  onRecopy,
  onDelete,
}: CaptureDetailProps) {
  return (
    <section class="capture-detail" aria-labelledby="capture-detail-title">
      <button class="back-button" type="button" onClick={onBack}>
        ‹ 履歴へ戻る
      </button>
      <h3 id="capture-detail-title">{formatTime(entry.capturedAtEpochMs)}の撮影</h3>
      <img class="detail-image" src={url} alt="撮影画像のプレビュー" />
      <p>
        {entry.widthPx} × {entry.heightPx} px · {formatBytes(entry.byteLength)}
      </p>
      <dl class="capture-metadata">
        <div>
          <dt>設定</dt>
          <dd>{capturePreferenceLabel(entry.preference)}</dd>
        </div>
        <div>
          <dt>実際の撮影経路</dt>
          <dd>{captureRouteLabel(entry.route)}</dd>
        </div>
        {entry.route === "videoFrame" && (
          <div>
            <dt>動画処理経路</dt>
            <dd>{videoFramePipelineLabel(diagnostics)}</dd>
          </div>
        )}
        <div>
          <dt>画像形式</dt>
          <dd>{entry.mimeType}</dd>
        </div>
        <div>
          <dt>Clipboard形式</dt>
          <dd>image/png</dd>
        </div>
      </dl>
      <details class="capture-timing">
        <summary>端末内の処理時間</summary>
        <dl>
          {DURATION_ROWS.map(([stage, label]) => (
            <div key={stage}>
              <dt>{label}</dt>
              <dd>{formatTiming(diagnostics.durations[stage])}</dd>
            </div>
          ))}
          {MILESTONE_ROWS.map(([milestone, label]) => (
            <div key={milestone}>
              <dt>{label}</dt>
              <dd>{formatTiming(diagnostics.milestones[milestone])}</dd>
            </div>
          ))}
          <div>
            <dt>Browser / OS Clipboard処理</dt>
            <dd>{formatTiming(browserClipboardDuration(diagnostics))}</dd>
          </div>
        </dl>
        <p class="capture-user-agent">{navigator.userAgent}</p>
      </details>
      <div class="detail-actions">
        <button class="primary-button" type="button" onClick={onRecopy}>
          <CopyIcon />
          再コピー
        </button>
        <button class="delete-button" type="button" onClick={onDelete}>
          <TrashIcon />
          削除
        </button>
      </div>
    </section>
  );
}

function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(epochMs);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const DURATION_ROWS = [
  ["sourceAcquisition", "写真取得"],
  ["videoFrameAcquire", "動画フレーム取得"],
  ["videoFrameTransfer", "動画フレームWorker handoff"],
  ["videoFrameRaster", "動画フレームraster準備"],
  ["videoFramePngEncode", "動画フレームPNG encode"],
  ["imageDecode", "画像decode / raster準備"],
  ["clipboardEncode", "Clipboard用PNG変換"],
  ["thumbnail", "サムネイル"],
] as const;

const MILESTONE_ROWS = [
  ["clipboardRepresentationReady", "Clipboard画像準備（撮影から）"],
  ["clipboardSettled", "Clipboard完了（撮影から）"],
] as const;

function formatTiming(value: Option<number> | undefined): string {
  if (value === undefined) return "計測待ち";
  return value.tag === "none" ? "未実行" : `${Math.round(value.value)} ms`;
}

function capturePreferenceLabel(preference: CaptureEntry["preference"]): string {
  return preference === "photoPreferred" ? "写真優先" : "動画フレーム";
}

function captureRouteLabel(route: CaptureEntry["route"]): string {
  return route === "photo" ? "写真API" : "動画フレーム";
}

function videoFramePipelineLabel(diagnostics: CaptureDiagnostics): string {
  const transfer = diagnostics.durations.videoFrameTransfer;
  if (transfer === undefined) return "計測待ち";
  return transfer.tag === "some" ? "Worker OffscreenCanvas (2D)" : "main-thread Canvas";
}

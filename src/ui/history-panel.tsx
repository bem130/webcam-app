import { useEffect, useRef } from "preact/hooks";
import type { CaptureEntry, CaptureId } from "../core/model";
import { CloseIcon, CopyIcon, TrashIcon } from "./icons";

type HistoryPanelProps = Readonly<{
  open: boolean;
  entries: readonly CaptureEntry[];
  selected: CaptureId | null;
  thumbnailUrl: (entry: CaptureEntry) => string;
  detailUrl: (entry: CaptureEntry) => string;
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
        {props.entries.map((entry) => (
          <button
            key={entry.id}
            class="history-item"
            type="button"
            onClick={() => props.onSelect(entry.id)}
          >
            <img
              src={props.thumbnailUrl(entry)}
              alt={`${formatTime(entry.capturedAtEpochMs)}に撮影した画像`}
            />
            <span>{formatTime(entry.capturedAtEpochMs)}</span>
            <small>
              {entry.widthPx} × {entry.heightPx} · {formatBytes(entry.byteLength)}
            </small>
          </button>
        ))}
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
  onBack: () => void;
  onRecopy: () => void;
  onDelete: () => void;
}>;

function CaptureDetail({ entry, url, onBack, onRecopy, onDelete }: CaptureDetailProps) {
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

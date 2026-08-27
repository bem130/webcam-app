import { useEffect, useRef } from "preact/hooks";

type ConfirmDialogProps = Readonly<{
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>;

export function ConfirmDialog({ open, onCancel, onConfirm }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} class="confirm-dialog" aria-labelledby="clear-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="clear-title">すべての履歴を消去しますか？</h2>
      <p>この操作は取り消せません。Clipboardの内容は変更されません。</p>
      <div>
        <button type="button" onClick={onCancel}>キャンセル</button>
        <button class="delete-button" type="button" onClick={onConfirm}>すべて消去</button>
      </div>
    </dialog>
  );
}

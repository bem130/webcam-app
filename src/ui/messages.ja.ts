import type { CameraError, CaptureError, ClipboardError } from "../core/errors";
import { assertNever } from "../core/result";

export function cameraErrorMessage(error: CameraError): string {
  switch (error.tag) {
    case "insecureContext": return "安全な接続で開く必要があります。HTTPSのURLを使用してください。";
    case "unsupported": return "このブラウザはカメラAPIに対応していません。";
    case "permissionDenied": return "カメラの使用が許可されていません。ブラウザの設定を確認してください。";
    case "noCamera": return "利用できるカメラが見つかりません。接続後に再試行してください。";
    case "cameraUnavailable": return "カメラを開始できません。他のアプリが使用中の可能性があります。";
    case "constraintsUnsatisfied": return "選択したカメラを指定した条件で開始できません。";
    case "streamEnded": return "カメラとの接続が終了しました。";
    case "unknown": return "カメラを開始できませんでした。";
    default: return assertNever(error);
  }
}

export function captureErrorMessage(error: CaptureError): string {
  switch (error.tag) {
    case "frameNotReady": return "映像の準備が完了していません。少し待って再撮影してください。";
    case "canvasUnavailable": return "このブラウザでは画像を作成できません。";
    case "pngEncodingFailed": return "画像を作成できませんでした。もう一度撮影してください。";
    case "memoryAllocationFailed": return "画像を作成するためのメモリが不足しています。";
    default: return assertNever(error);
  }
}

export function clipboardErrorMessage(error: ClipboardError): string {
  switch (error.tag) {
    case "unsupported": return "このブラウザは画像のClipboardコピーに対応していません。";
    case "notAllowed": return "Clipboardへの書込みが許可されませんでした。履歴から再コピーできます。";
    case "unsupportedMime": return "このブラウザはPNGのClipboardコピーに対応していません。";
    case "writeFailed": return "撮影しましたが、Clipboardへコピーできませんでした。";
    default: return assertNever(error);
  }
}

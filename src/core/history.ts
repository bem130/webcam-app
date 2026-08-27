import type { CaptureEntry, CaptureId } from "./model";

export const MEMORY_WARNING_BYTES = 128 * 1024 * 1024;

export function addCapture(history: readonly CaptureEntry[], entry: CaptureEntry): readonly CaptureEntry[] {
  return [entry, ...history];
}

export function removeCapture(history: readonly CaptureEntry[], id: CaptureId): readonly CaptureEntry[] {
  return history.filter((entry) => entry.id !== id);
}

export function historyByteLength(history: readonly CaptureEntry[]): number {
  return history.reduce((total, entry) => total + entry.png.size + entry.thumbnail.size, 0);
}

export function shouldWarnAboutMemory(
  history: readonly CaptureEntry[],
  warningAlreadyShown: boolean,
): boolean {
  return !warningAlreadyShown && historyByteLength(history) > MEMORY_WARNING_BYTES;
}

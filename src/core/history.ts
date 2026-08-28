import type { CaptureEntry, CaptureId } from "./model";

export const MEMORY_WARNING_BYTES = 128 * 1024 * 1024;

export function addCapture(
  history: readonly CaptureEntry[],
  entry: CaptureEntry,
): readonly CaptureEntry[] {
  return [entry, ...history];
}

export function removeCapture(
  history: readonly CaptureEntry[],
  id: CaptureId,
): readonly CaptureEntry[] {
  return history.filter((entry) => entry.id !== id);
}

export function addCaptureThumbnail(
  history: readonly CaptureEntry[],
  id: CaptureId,
  thumbnail: Blob,
): readonly CaptureEntry[] {
  return history.map((entry) =>
    entry.id === id ? { ...entry, thumbnail: { tag: "some", value: thumbnail } } : entry,
  );
}

export function historyByteLength(history: readonly CaptureEntry[]): number {
  return history.reduce(
    (total, entry) =>
      total + entry.blob.size + (entry.thumbnail.tag === "some" ? entry.thumbnail.value.size : 0),
    0,
  );
}

export function shouldWarnAboutMemory(
  history: readonly CaptureEntry[],
  warningAlreadyShown: boolean,
): boolean {
  return !warningAlreadyShown && historyByteLength(history) > MEMORY_WARNING_BYTES;
}

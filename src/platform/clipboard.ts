import { causeName, type ClipboardError } from "../core/errors";
import { err, ok, type Result } from "../core/result";

export const PNG_MIME = "image/png" as const;

export type ClipboardPort = Readonly<{
  createItem: (png: Promise<Blob>) => ClipboardItem;
  write: (items: ClipboardItem[]) => Promise<void>;
}>;

export function browserClipboardPort(): ClipboardPort {
  return {
    createItem: (png) => new ClipboardItem({ [PNG_MIME]: png }),
    write: (items) => navigator.clipboard.write(items),
  };
}

export function beginPngWrite(
  png: Promise<Blob>,
  port: ClipboardPort,
): Promise<Result<void, ClipboardError>> {
  let write: Promise<void>;
  try {
    write = port.write([port.createItem(png)]);
  } catch (cause) {
    return Promise.resolve(err(mapClipboardError(cause)));
  }
  return write.then(
    () => ok(undefined),
    (cause: unknown) => err(mapClipboardError(cause)),
  );
}

export function mapClipboardError(cause: unknown): ClipboardError {
  const name = causeName(cause);
  if (name === "NotAllowedError" || name === "SecurityError") return { tag: "notAllowed" };
  if (name === "NotSupportedError") return { tag: "unsupportedMime", mime: PNG_MIME };
  return { tag: "writeFailed", causeName: name };
}

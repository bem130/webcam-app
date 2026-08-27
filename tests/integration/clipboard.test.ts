import { describe, expect, it } from "vitest";
import { beginPngWrite, type ClipboardPort } from "../../src/platform/clipboard";

describe("clipboard adapter contract", () => {
  it("calls clipboard.write synchronously before PNG settles", async () => {
    const events: string[] = [];
    let resolvePng!: (blob: Blob) => void;
    const png = new Promise<Blob>((resolve) => {
      resolvePng = resolve;
    });
    const port: ClipboardPort = {
      createItem: (value) => {
        events.push("create-item");
        expect(value).toBe(png);
        return {} as ClipboardItem;
      },
      write: () => {
        events.push("write");
        return Promise.resolve();
      },
    };

    const result = beginPngWrite(png, port);
    events.push("handler-returned");
    expect(events).toEqual(["create-item", "write", "handler-returned"]);
    resolvePng(new Blob());
    expect(await result).toEqual({ tag: "ok", value: undefined });
  });

  it("converts a rejected write to a typed error", async () => {
    const port: ClipboardPort = {
      createItem: () => ({}) as ClipboardItem,
      write: () => Promise.reject(new DOMException("", "NotAllowedError")),
    };
    expect(await beginPngWrite(Promise.resolve(new Blob()), port)).toEqual({
      tag: "err",
      error: { tag: "notAllowed" },
    });
  });
});

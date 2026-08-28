import { describe, expect, it, vi } from "vitest";
import { some } from "../../src/core/result";
import { discoverNativePhotoCapture } from "../../src/platform/native-photo";

describe("native photo discovery", () => {
  it("requests the maximum advertised still dimensions", async () => {
    const blob = new Blob(["photo"]);
    const takePhoto = vi.fn(() => Promise.resolve(blob));
    const track = { readyState: "live" } as MediaStreamTrack;
    const capture = await discoverNativePhotoCapture(
      track,
      some(() => ({
        getPhotoCapabilities: () =>
          Promise.resolve({
            imageWidth: { min: 640, max: 8160, step: 1 },
            imageHeight: { min: 480, max: 6120, step: 1 },
          }),
        takePhoto,
      })),
    );

    expect(capture).toMatchObject({
      tag: "some",
      value: { maximum: { widthPx: 8160, heightPx: 6120 } },
    });
    if (capture.tag === "none") throw new Error("native photo route missing");
    await expect(capture.value.takePhoto()).resolves.toBe(blob);
    expect(takePhoto).toHaveBeenCalledWith({ imageWidth: 8160, imageHeight: 6120 });
  });

  it("returns no native route when capability discovery fails", async () => {
    const track = { readyState: "live" } as MediaStreamTrack;
    const capture = await discoverNativePhotoCapture(
      track,
      some(() => ({
        getPhotoCapabilities: () => Promise.reject(new DOMException("", "OperationError")),
        takePhoto: vi.fn(),
      })),
    );

    expect(capture).toEqual({ tag: "none" });
  });

  it("does not inspect an ended track", async () => {
    const factory = vi.fn();
    await expect(
      discoverNativePhotoCapture({ readyState: "ended" } as MediaStreamTrack, some(factory)),
    ).resolves.toEqual({ tag: "none" });
    expect(factory).not.toHaveBeenCalled();
  });
});

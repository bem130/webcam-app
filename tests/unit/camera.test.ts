import { describe, expect, it, vi } from "vitest";
import { cameraVideoSettings, preferMaximumVideoResolution } from "../../src/platform/camera";

describe("camera video quality", () => {
  it("requests the maximum advertised width and height as ideals", async () => {
    const applyConstraints = vi.fn(() => Promise.resolve());
    const track = {
      getCapabilities: () => ({ width: { min: 320, max: 7680 }, height: { min: 240, max: 4320 } }),
      applyConstraints,
    } as unknown as MediaStreamTrack;

    await expect(preferMaximumVideoResolution(track)).resolves.toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 7680 },
      height: { ideal: 4320 },
    });
  });

  it("keeps the negotiated stream when capability application fails", async () => {
    const track = {
      getCapabilities: () => ({ width: { min: 320, max: 3840 } }),
      applyConstraints: vi.fn(() => Promise.reject(new DOMException("", "OverconstrainedError"))),
    } as unknown as MediaStreamTrack;

    await expect(preferMaximumVideoResolution(track)).resolves.toBe(false);
  });

  it("keeps the negotiated stream when capabilities cannot be read", async () => {
    const applyConstraints = vi.fn();
    const track = {
      getCapabilities: () => {
        throw new DOMException("", "InvalidStateError");
      },
      applyConstraints,
    } as unknown as MediaStreamTrack;

    await expect(preferMaximumVideoResolution(track)).resolves.toBe(false);
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it("reports actual track settings separately from requested capabilities", () => {
    const stream = {
      getVideoTracks: () => [
        { getSettings: () => ({ width: 3840, height: 2160, frameRate: 29.97 }) },
      ],
    } as unknown as MediaStream;

    expect(cameraVideoSettings(stream)).toEqual({
      tag: "some",
      value: {
        widthPx: 3840,
        heightPx: 2160,
        frameRate: { tag: "some", value: 29.97 },
      },
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { setStreamEnabled, stopStream } from "../../src/platform/camera";
import { bindDocumentLifecycle } from "../../src/platform/lifecycle";

afterEach(() => vi.unstubAllGlobals());

describe("camera and document lifecycle", () => {
  it("disables and stops every relevant track", () => {
    const stopVideo = vi.fn();
    const stopAudio = vi.fn();
    const videoTrack = { enabled: true, stop: stopVideo } as unknown as MediaStreamTrack;
    const audioTrack = { enabled: true, stop: stopAudio } as unknown as MediaStreamTrack;
    const stream = {
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack, audioTrack],
    } as unknown as MediaStream;

    setStreamEnabled(stream, false);
    expect(videoTrack.enabled).toBe(false);
    expect(audioTrack.enabled).toBe(true);
    stopStream(stream);
    expect(stopVideo).toHaveBeenCalledOnce();
    expect(stopAudio).toHaveBeenCalledOnce();
  });

  it("routes hidden, visible, and pagehide events and removes listeners", () => {
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(documentTarget, "visibilityState", { get: () => visibility });
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    const onHidden = vi.fn();
    const onVisible = vi.fn();
    const onPageHide = vi.fn();
    const unbind = bindDocumentLifecycle({ onHidden, onVisible, onPageHide });

    visibility = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(onHidden).toHaveBeenCalledOnce();
    expect(onVisible).toHaveBeenCalledOnce();
    expect(onPageHide).toHaveBeenCalledOnce();

    unbind();
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(onVisible).toHaveBeenCalledOnce();
  });
});

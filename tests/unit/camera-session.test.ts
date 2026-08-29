import { describe, expect, it, vi } from "vitest";
import { hardStopCameraStream } from "../../src/application/camera-session";
import { cameraId } from "../../src/core/model";
import { some } from "../../src/core/result";

describe("camera session", () => {
  it("retains the active camera id, stops every track once, and detaches the video", () => {
    const stopVideo = vi.fn();
    const stopAudio = vi.fn();
    const videoTrack = {
      getSettings: () => ({ deviceId: "rear" }),
      stop: stopVideo,
    } as unknown as MediaStreamTrack;
    const audioTrack = { stop: stopAudio } as unknown as MediaStreamTrack;
    const stream = {
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack, audioTrack],
    } as unknown as MediaStream;
    const video = { srcObject: stream } as HTMLVideoElement;

    expect(hardStopCameraStream(video, stream)).toEqual(some(cameraId("rear")));
    expect(stopVideo).toHaveBeenCalledOnce();
    expect(stopAudio).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });
});

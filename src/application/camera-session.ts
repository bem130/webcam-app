import type { CameraVideoSettings } from "../core/model";
import type { Option } from "../core/result";
import { cameraVideoSettings } from "../platform/camera";

export async function attachCameraStream(
  video: HTMLVideoElement,
  stream: MediaStream,
  onEnded: () => void,
): Promise<Option<CameraVideoSettings>> {
  stream.getVideoTracks()[0]?.addEventListener("ended", onEnded, { once: true });
  video.srcObject = stream;
  await video.play();
  await waitForVideoFrame(video);
  return cameraVideoSettings(stream);
}

export function drawSwitchPlaceholder(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): void {
  if (video === null || canvas === null || video.videoWidth === 0 || video.videoHeight === 0) {
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
}

export function clearSwitchPlaceholder(canvas: HTMLCanvasElement | null): void {
  if (canvas === null) return;
  canvas.width = 1;
  canvas.height = 1;
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error("frame-timeout"))), 5000);
    const ready = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish(resolve);
    };
    const finish = (complete: () => void) => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("canplay", ready);
      complete();
    };
    video.addEventListener("loadeddata", ready);
    video.addEventListener("canplay", ready);
  });
}

export type CaptureStart = Readonly<{
  png: Promise<Blob>;
  clipboard: Promise<void>;
}>;

const PNG_TYPE = "image/png";
const MAX_LONG_EDGE_PX = 1920;

function encodeFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return Promise.reject(new Error("frame-not-ready"));
  }

  const scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return Promise.reject(new Error("canvas-unavailable"));
  }
  context.drawImage(video, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("png-encoding-failed"));
        return;
      }
      resolve(blob);
    }, PNG_TYPE);
  });
}

export function beginCaptureAndCopy(video: HTMLVideoElement): CaptureStart {
  const png = encodeFrame(video);
  // Safari preserves the user gesture only when write() starts in this event stack.
  const clipboard = navigator.clipboard.write([
    new ClipboardItem({ [PNG_TYPE]: png }),
  ]);
  return { png, clipboard };
}


import type { PhotoCaptureSettings } from "../core/model";
import type { Option } from "../core/result";
import { none, some } from "../core/result";

export type NativePhotoCapture = Readonly<{
  track: MediaStreamTrack;
  maximum: PhotoCaptureSettings;
  takePhoto: () => Promise<Blob>;
}>;

export type ImageCaptureAdapter = Pick<ImageCapture, "getPhotoCapabilities" | "takePhoto">;
export type ImageCaptureFactory = (track: MediaStreamTrack) => ImageCaptureAdapter;

export function isNativePhotoCaptureSupported(): boolean {
  return typeof globalThis.ImageCapture === "function";
}

export async function discoverNativePhotoCapture(
  track: MediaStreamTrack | undefined,
  factory: Option<ImageCaptureFactory> = none,
): Promise<Option<NativePhotoCapture>> {
  if (track === undefined || track.readyState !== "live") return none;
  if (factory.tag === "none" && !isNativePhotoCaptureSupported()) return none;

  try {
    const imageCapture =
      factory.tag === "some" ? factory.value(track) : new globalThis.ImageCapture(track);
    const capabilities = await imageCapture.getPhotoCapabilities();
    const width = positiveMaximum(capabilities.imageWidth);
    const height = positiveMaximum(capabilities.imageHeight);
    if (width.tag === "none" || height.tag === "none") return none;
    const maximum = { widthPx: width.value, heightPx: height.value };
    return some({
      track,
      maximum,
      takePhoto: () =>
        imageCapture.takePhoto({ imageWidth: width.value, imageHeight: height.value }),
    });
  } catch {
    return none;
  }
}

function positiveMaximum(range: MediaSettingsRange | undefined): Option<number> {
  const maximum = range?.max;
  return maximum !== undefined && Number.isFinite(maximum) && maximum > 0 ? some(maximum) : none;
}

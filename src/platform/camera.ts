import { causeName, type CameraError } from "../core/errors";
import {
  cameraId,
  type CameraDescriptor,
  type CameraFacing,
  type CameraId,
  type CameraVideoSettings,
} from "../core/model";
import { err, none, ok, some, type Option, type Result } from "../core/result";

export const INITIAL_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    frameRate: { ideal: 30, max: 30 },
  },
};

export async function requestInitialCamera(): Promise<Result<MediaStream, CameraError>> {
  if (!window.isSecureContext) return err({ tag: "insecureContext" });
  if (navigator.mediaDevices?.getUserMedia === undefined) return err({ tag: "unsupported" });
  return requestCamera(INITIAL_CONSTRAINTS);
}

export function requestSpecificCamera(id: CameraId): Promise<Result<MediaStream, CameraError>> {
  return requestCamera({ audio: false, video: { deviceId: { exact: id } } });
}

async function requestCamera(
  constraints: MediaStreamConstraints,
): Promise<Result<MediaStream, CameraError>> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    await preferMaximumVideoResolution(stream.getVideoTracks()[0]);
    return ok(stream);
  } catch (cause) {
    return err(mapCameraError(cause));
  }
}

export async function preferMaximumVideoResolution(
  track: MediaStreamTrack | undefined,
): Promise<boolean> {
  if (track === undefined || typeof track.getCapabilities !== "function") return false;
  try {
    const capabilities = track.getCapabilities();
    const width = positiveMaximum(capabilities.width);
    const height = positiveMaximum(capabilities.height);
    if (width === null && height === null) return false;

    const constraints: MediaTrackConstraints = {};
    if (width !== null) constraints.width = { ideal: width };
    if (height !== null) constraints.height = { ideal: height };
    await track.applyConstraints(constraints);
    return true;
  } catch {
    return false;
  }
}

export function cameraVideoSettings(stream: MediaStream): Option<CameraVideoSettings> {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const width = settings?.width;
  const height = settings?.height;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return none;
  const frameRate = settings?.frameRate;
  return some({
    widthPx: width,
    heightPx: height,
    frameRate: frameRate === undefined || frameRate <= 0 ? none : some(frameRate),
  });
}

export async function enumerateCameras(): Promise<readonly CameraDescriptor[]> {
  if (navigator.mediaDevices?.enumerateDevices === undefined) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return cameraDescriptorsFromDevices(devices);
}

export function cameraDescriptorsFromDevices(
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
): readonly CameraDescriptor[] {
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      id: cameraId(device.deviceId),
      label: device.label.trim() || `カメラ ${index + 1}`,
      facing: facingFromLabel(device.label),
    }));
}

export function currentCameraId(stream: MediaStream): Option<CameraId> {
  const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
  return id ? some(cameraId(id)) : none;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function setStreamEnabled(stream: MediaStream | null, enabled: boolean): void {
  stream?.getVideoTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function mapCameraError(cause: unknown): CameraError {
  switch (causeName(cause)) {
    case "NotAllowedError":
    case "SecurityError":
      return { tag: "permissionDenied" };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { tag: "noCamera" };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { tag: "cameraUnavailable" };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { tag: "constraintsUnsatisfied" };
    default:
      return { tag: "unknown", causeName: causeName(cause) };
  }
}

function facingFromLabel(label: string): CameraFacing {
  const normalized = label.toLocaleLowerCase();
  if (/front|facetime|user|前面|インカメラ/.test(normalized)) return "user";
  if (/back|rear|environment|背面|アウトカメラ/.test(normalized)) return "environment";
  if (/\bleft\b/.test(normalized)) return "left";
  if (/\bright\b/.test(normalized)) return "right";
  return "unknown";
}

function positiveMaximum(range: { max?: number } | undefined): number | null {
  const maximum = range?.max;
  return maximum !== undefined && Number.isFinite(maximum) && maximum > 0 ? maximum : null;
}

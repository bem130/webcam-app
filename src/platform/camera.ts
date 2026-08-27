import { causeName, type CameraError } from "../core/errors";
import { cameraId, type CameraDescriptor, type CameraFacing, type CameraId } from "../core/model";
import { err, ok, type Result } from "../core/result";

export const INITIAL_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
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

async function requestCamera(constraints: MediaStreamConstraints): Promise<Result<MediaStream, CameraError>> {
  try {
    return ok(await navigator.mediaDevices.getUserMedia(constraints));
  } catch (cause) {
    return err(mapCameraError(cause));
  }
}

export async function enumerateCameras(): Promise<readonly CameraDescriptor[]> {
  if (navigator.mediaDevices?.enumerateDevices === undefined) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      id: cameraId(device.deviceId),
      label: device.label.trim() || `カメラ ${index + 1}`,
      facing: facingFromLabel(device.label),
    }));
}

export function currentCameraId(stream: MediaStream): CameraId | null {
  const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
  return id ? cameraId(id) : null;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function setStreamEnabled(stream: MediaStream | null, enabled: boolean): void {
  stream?.getVideoTracks().forEach((track) => { track.enabled = enabled; });
}

export function mapCameraError(cause: unknown): CameraError {
  switch (causeName(cause)) {
    case "NotAllowedError":
    case "SecurityError": return { tag: "permissionDenied" };
    case "NotFoundError":
    case "DevicesNotFoundError": return { tag: "noCamera" };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError": return { tag: "cameraUnavailable" };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError": return { tag: "constraintsUnsatisfied" };
    default: return { tag: "unknown", causeName: causeName(cause) };
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

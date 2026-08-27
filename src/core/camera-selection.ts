import type { CameraDescriptor, CameraFacing, CameraId } from "./model";
import { none, some, type Option } from "./result";

export function chooseQuickSwapTarget(
  cameras: readonly CameraDescriptor[],
  current: Option<CameraId>,
  previous: Option<CameraId>,
): Option<CameraId> {
  if (cameras.length < 2) return none;
  if (
    previous.tag === "some" &&
    previous.value !== currentValue(current) &&
    hasCamera(cameras, previous.value)
  ) {
    return previous;
  }

  const currentIndex =
    current.tag === "some" ? cameras.findIndex((camera) => camera.id === current.value) : -1;
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % cameras.length;
  const next = cameras[nextIndex];
  return next === undefined ? none : some(next.id);
}

export function reconcileCurrentCamera(
  cameras: readonly CameraDescriptor[],
  current: Option<CameraId>,
): Option<CameraId> {
  if (current.tag === "some" && hasCamera(cameras, current.value)) return current;
  const first = cameras[0];
  return first === undefined ? none : some(first.id);
}

export function shouldMirrorPreview(facing: CameraFacing): boolean {
  return facing === "user";
}

function hasCamera(cameras: readonly CameraDescriptor[], id: CameraId): boolean {
  return cameras.some((camera) => camera.id === id);
}

function currentValue(current: Option<CameraId>): CameraId | undefined {
  return current.tag === "some" ? current.value : undefined;
}

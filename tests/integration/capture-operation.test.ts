import { describe, expect, it, vi } from "vitest";
import type { CaptureTimingMeasurement } from "../../src/core/model";
import { some } from "../../src/core/result";
import {
  beginCaptureAndCopy,
  beginCapturedImageCopy,
  type CaptureEncoder,
} from "../../src/platform/capture";
import type { ClipboardPort } from "../../src/platform/clipboard";
import type { ImageProcessingPort, PreparedImage } from "../../src/platform/image-processing";
import type { NativePhotoCapture } from "../../src/platform/native-photo";

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe("capture operation", () => {
  it("keeps a successful video artifact separate from a failed Clipboard write", async () => {
    const png = imageBlob("png", "image/png");
    const thumbnail = imageBlob("thumbnail", "image/jpeg");
    const encoder = fakeEncoder({ video: Promise.resolve({ blob: png, width: 640, height: 480 }) });
    encoder.encodeThumbnail.mockResolvedValue(thumbnail);
    const clipboard: ClipboardPort = {
      createItem: vi.fn(() => ({}) as ClipboardItem),
      write: vi.fn(() => Promise.reject(new DOMException("", "NotAllowedError"))),
    };

    const operation = beginCaptureAndCopy(video, { encoder, clipboardPort: clipboard });
    await expect(operation.captured).resolves.toEqual({
      tag: "ok",
      value: {
        blob: png,
        mimeType: "image/png",
        width: 640,
        height: 480,
        route: "videoFrame",
      },
    });
    await expect(operation.thumbnail).resolves.toEqual({ tag: "ok", value: thumbnail });
    await expect(operation.clipboard).resolves.toEqual({
      tag: "err",
      error: { tag: "notAllowed" },
    });
  });

  it("returns a typed capture failure without creating a history-ready value", async () => {
    const encoder = fakeEncoder({ video: Promise.reject(new Error("encode failed")) });
    const operation = beginCaptureAndCopy(video, {
      encoder,
      clipboardPort: successfulClipboard(),
    });

    await expect(operation.captured).resolves.toEqual({
      tag: "err",
      error: { tag: "pngEncodingFailed" },
    });
    await expect(operation.thumbnail).resolves.toEqual({
      tag: "err",
      error: { tag: "pngEncodingFailed" },
    });
    expect(encoder.encodeThumbnail).not.toHaveBeenCalled();
  });

  it("keeps a native still artifact without full-size history re-encoding", async () => {
    const photo = imageBlob("photo", "image/jpeg");
    const clipboardPng = imageBlob("clipboard", "image/png");
    const conversion = deferred<Blob>();
    const encoder = fakeEncoder();
    const imageProcessing = fakeImageProcessing({
      dimensions: { width: 8160, height: 6120 },
      clipboardPng: conversion.promise,
    });
    const nativePhoto = fakeNativePhoto(() => Promise.resolve(photo));
    const operation = beginCaptureAndCopy(video, {
      encoder,
      imageProcessing,
      clipboardPort: clipboardAwaitingPayload(),
      nativePhoto: some(nativePhoto),
      preference: "photoPreferred",
    });

    await expect(operation.captured).resolves.toEqual({
      tag: "ok",
      value: {
        blob: photo,
        mimeType: "image/jpeg",
        width: 8160,
        height: 6120,
        route: "photo",
      },
    });
    expect(encoder.encodeVideoFramePng).not.toHaveBeenCalled();
    expect(imageProcessing.prepare).toHaveBeenCalledWith(photo, true);
    expect(encoder.encodeBlobPng).not.toHaveBeenCalled();
    expect(encoder.encodeThumbnail).not.toHaveBeenCalled();
    conversion.resolve(clipboardPng);
    await expect(operation.clipboard).resolves.toEqual({ tag: "ok", value: undefined });
    await expect(operation.thumbnail).resolves.toMatchObject({ tag: "ok" });
  });

  it("passes a native PNG directly to Clipboard without compatibility encoding", async () => {
    const photo = imageBlob("photo", "image/png");
    const encoder = fakeEncoder();
    const imageProcessing = fakeImageProcessing({
      dimensions: { width: 4032, height: 3024 },
      clipboardPng: Promise.resolve(photo),
    });
    const operation = beginCaptureAndCopy(video, {
      encoder,
      imageProcessing,
      clipboardPort: clipboardAwaitingPayload(),
      nativePhoto: some(fakeNativePhoto(() => Promise.resolve(photo))),
      preference: "photoPreferred",
    });

    await expect(operation.captured).resolves.toMatchObject({
      tag: "ok",
      value: { blob: photo, mimeType: "image/png", route: "photo" },
    });
    await expect(operation.clipboard).resolves.toEqual({ tag: "ok", value: undefined });
    expect(encoder.encodeBlobPng).not.toHaveBeenCalled();
    expect(imageProcessing.prepare).toHaveBeenCalledWith(photo, false);
  });

  it("starts thumbnail encoding only after Clipboard success or failure settles", async () => {
    const photo = imageBlob("photo", "image/png");
    const clipboardSettlement = deferred<void>();
    const encodeThumbnail = vi.fn(() => Promise.resolve(imageBlob("thumbnail", "image/jpeg")));
    const imageProcessing: ImageProcessingPort = {
      prepare: vi.fn(() =>
        Promise.resolve({
          dimensions: { width: 4, height: 3 },
          clipboardPng: Promise.resolve({ blob: photo, durationMs: 0 }),
          encodeThumbnail,
          dispose: vi.fn(),
        }),
      ),
      dispose: vi.fn(),
    };
    const operation = beginCaptureAndCopy(video, {
      encoder: fakeEncoder(),
      imageProcessing,
      clipboardPort: {
        createItem: vi.fn(() => ({}) as ClipboardItem),
        write: vi.fn(() => clipboardSettlement.promise),
      },
      nativePhoto: some(fakeNativePhoto(() => Promise.resolve(photo))),
    });

    await expect(operation.captured).resolves.toMatchObject({ tag: "ok" });
    expect(encodeThumbnail).not.toHaveBeenCalled();
    clipboardSettlement.resolve(undefined);
    await expect(operation.clipboard).resolves.toMatchObject({ tag: "ok" });
    await expect(operation.thumbnail).resolves.toMatchObject({ tag: "ok" });
    expect(encodeThumbnail).toHaveBeenCalledOnce();
  });

  it("falls back once to the live video frame without changing the preference", async () => {
    const png = imageBlob("png", "image/png");
    const encoder = fakeEncoder({ video: Promise.resolve({ blob: png, width: 640, height: 480 }) });
    const nativePhoto = fakeNativePhoto(() => Promise.reject(new Error("photo failed")));
    const operation = beginCaptureAndCopy(video, {
      encoder,
      clipboardPort: successfulClipboard(),
      nativePhoto: some(nativePhoto),
      preference: "photoPreferred",
    });

    await expect(operation.captured).resolves.toMatchObject({
      tag: "ok",
      value: { route: "videoFrame", width: 640, height: 480 },
    });
    expect(encoder.encodeVideoFramePng).toHaveBeenCalledOnce();
  });

  it("falls back when the returned native image cannot be decoded", async () => {
    const png = imageBlob("png", "image/png");
    const encoder = fakeEncoder({
      video: Promise.resolve({ blob: png, width: 640, height: 480 }),
    });
    const imageProcessing = fakeImageProcessing({ prepareError: new Error("decode failed") });
    const operation = beginCaptureAndCopy(video, {
      encoder,
      imageProcessing,
      clipboardPort: successfulClipboard(),
      nativePhoto: some(fakeNativePhoto(() => Promise.resolve(imageBlob("photo", "image/jpeg")))),
      preference: "photoPreferred",
    });

    await expect(operation.captured).resolves.toMatchObject({
      tag: "ok",
      value: { route: "videoFrame" },
    });
    expect(encoder.encodeVideoFramePng).toHaveBeenCalledOnce();
  });

  it("does not capture a fallback frame from an ended native track", async () => {
    const encoder = fakeEncoder();
    const nativePhoto = fakeNativePhoto(() => Promise.reject(new Error("photo failed")), "ended");
    const operation = beginCaptureAndCopy(video, {
      encoder,
      clipboardPort: successfulClipboard(),
      nativePhoto: some(nativePhoto),
      preference: "photoPreferred",
    });

    await expect(operation.captured).resolves.toEqual({
      tag: "err",
      error: { tag: "photoCaptureFailed" },
    });
    expect(encoder.encodeVideoFramePng).not.toHaveBeenCalled();
  });

  it("never calls the native API when video-frame capture is selected", async () => {
    const png = imageBlob("png", "image/png");
    const encoder = fakeEncoder({ video: Promise.resolve({ blob: png, width: 640, height: 480 }) });
    const takePhoto = vi.fn(() => Promise.resolve(imageBlob("photo", "image/jpeg")));
    const operation = beginCaptureAndCopy(video, {
      encoder,
      clipboardPort: successfulClipboard(),
      nativePhoto: some(fakeNativePhoto(takePhoto)),
      preference: "videoFrame",
    });

    await expect(operation.captured).resolves.toMatchObject({
      tag: "ok",
      value: { route: "videoFrame" },
    });
    expect(takePhoto).not.toHaveBeenCalled();
  });

  it("records independent local stages and ignores a diagnostics observer failure", async () => {
    const png = imageBlob("png", "image/png");
    const encoder = fakeEncoder({ video: Promise.resolve({ blob: png, width: 640, height: 480 }) });
    const stages: string[] = [];
    const operation = beginCaptureAndCopy(video, {
      encoder,
      clipboardPort: successfulClipboard(),
      clock: steppedClock(),
      observeTiming: (measurement) => {
        stages.push(measurement.kind === "duration" ? measurement.stage : measurement.milestone);
        if (measurement.kind === "duration" && measurement.stage === "videoFrameEncode") {
          throw new Error("debug UI failed");
        }
      },
    });

    await Promise.all([operation.captured, operation.thumbnail, operation.clipboard]);
    expect(stages).toEqual(
      expect.arrayContaining([
        "videoFrameEncode",
        "clipboardEncode",
        "clipboardRepresentationReady",
        "thumbnail",
        "clipboardSettled",
      ]),
    );
    await expect(operation.captured).resolves.toMatchObject({ tag: "ok" });
  });

  it("keeps stage durations distinct from shutter-relative Clipboard milestones", async () => {
    const photo = imageBlob("photo", "image/jpeg");
    const measurements: CaptureTimingMeasurement[] = [];
    const imageProcessing: ImageProcessingPort = {
      prepare: vi.fn(() =>
        Promise.resolve({
          dimensions: { width: 4, height: 3 },
          clipboardPng: Promise.resolve({
            blob: imageBlob("png", "image/png"),
            durationMs: 321,
          }),
          encodeThumbnail: () => Promise.resolve(imageBlob("thumbnail", "image/jpeg")),
          dispose: vi.fn(),
        }),
      ),
      dispose: vi.fn(),
    };
    const operation = beginCaptureAndCopy(video, {
      encoder: fakeEncoder(),
      imageProcessing,
      clipboardPort: clipboardAwaitingPayload(),
      nativePhoto: some(fakeNativePhoto(() => Promise.resolve(photo))),
      clock: steppedClock(),
      observeTiming: (measurement) => measurements.push(measurement),
    });

    await Promise.all([operation.captured, operation.thumbnail, operation.clipboard]);
    expect(measurements).toContainEqual({
      kind: "duration",
      stage: "clipboardEncode",
      durationMs: some(321),
    });
    const milestones = measurements.filter((measurement) => measurement.kind === "milestone");
    expect(milestones.map((measurement) => measurement.milestone)).toEqual(
      expect.arrayContaining(["clipboardRepresentationReady", "clipboardSettled"]),
    );
    milestones.forEach((measurement) => expect(measurement.offsetFromShutterMs.tag).toBe("some"));
  });

  it("reuses the image-processing port for non-PNG history copies", async () => {
    const image = imageBlob("photo", "image/jpeg");
    const imageProcessing = fakeImageProcessing();
    const encoder = fakeEncoder();
    const write = beginCapturedImageCopy(
      { blob: image, mimeType: "image/jpeg" },
      { encoder, imageProcessing, clipboardPort: clipboardAwaitingPayload() },
    );

    await expect(write).resolves.toEqual({ tag: "ok", value: undefined });
    expect(imageProcessing.prepare).toHaveBeenCalledWith(image, true);
    expect(encoder.encodeBlobPng).not.toHaveBeenCalled();
  });
});

type FakeEncoder = CaptureEncoder &
  Readonly<{
    encodeVideoFramePng: ReturnType<typeof vi.fn<CaptureEncoder["encodeVideoFramePng"]>>;
    inspectImage: ReturnType<typeof vi.fn<CaptureEncoder["inspectImage"]>>;
    encodeBlobPng: ReturnType<typeof vi.fn<CaptureEncoder["encodeBlobPng"]>>;
    encodeThumbnail: ReturnType<typeof vi.fn<CaptureEncoder["encodeThumbnail"]>>;
  }>;

type FakeImageProcessing = ImageProcessingPort &
  Readonly<{ prepare: ReturnType<typeof vi.fn<ImageProcessingPort["prepare"]>> }>;

function fakeEncoder(
  options: {
    video?: ReturnType<CaptureEncoder["encodeVideoFramePng"]>;
  } = {},
): FakeEncoder {
  return {
    encodeVideoFramePng: vi.fn(
      () =>
        options.video ??
        Promise.resolve({ blob: imageBlob("png", "image/png"), width: 640, height: 480 }),
    ),
    inspectImage: vi.fn(() => Promise.resolve({ width: 1, height: 1 })),
    encodeBlobPng: vi.fn(() => Promise.resolve(imageBlob("png", "image/png"))),
    encodeThumbnail: vi.fn(() => Promise.resolve(imageBlob("thumbnail", "image/jpeg"))),
  };
}

function fakeImageProcessing(
  options: Readonly<{
    dimensions?: PreparedImage["dimensions"];
    clipboardPng?: Promise<Blob>;
    thumbnail?: Promise<Blob>;
    prepareError?: Error;
  }> = {},
): FakeImageProcessing {
  const prepared: PreparedImage = {
    dimensions: options.dimensions ?? { width: 1, height: 1 },
    clipboardPng: (
      options.clipboardPng ?? Promise.resolve(imageBlob("clipboard", "image/png"))
    ).then((blob) => ({ blob, durationMs: 5 })),
    encodeThumbnail: vi.fn(
      () => options.thumbnail ?? Promise.resolve(imageBlob("thumbnail", "image/jpeg")),
    ),
    dispose: vi.fn(),
  };
  return {
    prepare: vi.fn(() =>
      options.prepareError === undefined
        ? Promise.resolve(prepared)
        : Promise.reject(options.prepareError),
    ),
    dispose: vi.fn(),
  };
}

function successfulClipboard(): ClipboardPort {
  return {
    createItem: vi.fn(() => ({}) as ClipboardItem),
    write: vi.fn(() => Promise.resolve()),
  };
}

function clipboardAwaitingPayload(): ClipboardPort {
  let payload: Promise<Blob> | undefined;
  return {
    createItem: vi.fn((value: Promise<Blob>) => {
      payload = value;
      return {} as ClipboardItem;
    }),
    write: vi.fn(async () => {
      await payload;
    }),
  };
}

function fakeNativePhoto(
  takePhoto: () => Promise<Blob>,
  readyState: MediaStreamTrackState = "live",
): NativePhotoCapture {
  return {
    track: { readyState } as MediaStreamTrack,
    maximum: { widthPx: 8160, heightPx: 6120 },
    takePhoto,
  };
}

function imageBlob(value: string, type: `image/${string}`): Blob {
  return new Blob([value], { type });
}

function steppedClock(): () => number {
  let value = 0;
  return () => ++value;
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

"use client";

import type { ImageEmbedder } from "@mediapipe/tasks-vision";
import type { Box } from "@/lib/site-detector";

// MobileNetV3-small image embedder (4 MB) from the same MediaPipe package as
// the object detector. Runs on WebGL in a few milliseconds per frame, so every
// feed can be embedded several times a second on the dashboard.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite";

let embedder: Promise<ImageEmbedder> | null = null;
let lastTimestamp = 0;

export function loadAnchorEmbedder() {
  embedder ??= (async () => {
    const { FilesetResolver, ImageEmbedder } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const create = (delegate: "GPU" | "CPU") =>
      ImageEmbedder.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        l2Normalize: true,
      });
    return create("GPU").catch(() => create("CPU"));
  })().catch((cause) => {
    embedder = null;
    throw cause;
  });
  return embedder;
}

function embedOnce(instance: ImageEmbedder, video: HTMLVideoElement, roi?: Box) {
  lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
  const options = roi
    ? {
        regionOfInterest: {
          left: Math.max(0, roi.x / video.videoWidth),
          top: Math.max(0, roi.y / video.videoHeight),
          right: Math.min(1, (roi.x + roi.width) / video.videoWidth),
          bottom: Math.min(1, (roi.y + roi.height) / video.videoHeight),
        },
      }
    : undefined;
  const result = instance.embedForVideo(video, lastTimestamp, options);
  return result.embeddings[0]?.floatEmbedding ?? null;
}

/**
 * Embeddings for the current frame: the whole frame, and when a detector box
 * is available also the crop inside it. Matching takes the best of either, so
 * a view matches both when the surroundings are familiar and when only the
 * object itself is (phone at a different angle).
 */
export function embedVariants(instance: ImageEmbedder, video: HTMLVideoElement, box: Box | null) {
  const variants: number[][] = [];
  const full = embedOnce(instance, video);
  if (full) variants.push(full);
  if (box && box.width > 32 && box.height > 32) {
    const crop = embedOnce(instance, video, box);
    if (crop) variants.push(crop);
  }
  return variants;
}

export { cosine } from "@/lib/anchor-match";

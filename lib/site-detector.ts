"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { DETECTOR_CLASSES, siteKind } from "@/lib/site-kinds";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** Detector class ("refrigerator", "dining table"). */
  label: string;
  /** Everyday word for it ("fridge", "table"). */
  site: string;
};

let detector: Promise<ObjectDetector> | null = null;
let lastTimestamp = 0;

export function loadSiteDetector() {
  detector ??= (async () => {
    const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const create = (delegate: "GPU" | "CPU") =>
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        scoreThreshold: 0.3,
        maxResults: 3,
        categoryAllowlist: DETECTOR_CLASSES,
      });
    return create("GPU").catch(() => create("CPU"));
  })().catch((cause) => {
    detector = null;
    throw cause;
  });
  return detector;
}

/** The highest-scoring site class in the frame, or null. */
export function detectSite(instance: ObjectDetector, video: HTMLVideoElement): Box | null {
  lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
  const result = instance.detectForVideo(video, lastTimestamp);
  let best: Box | null = null;
  for (const detection of result.detections) {
    const box = detection.boundingBox;
    const category = detection.categories[0];
    if (!box || !category) continue;
    if (best && category.score <= best.score) continue;
    const label = category.categoryName;
    best = {
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
      score: category.score,
      label,
      site: siteKind(label) ?? label,
    };
  }
  return best;
}

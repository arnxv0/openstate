"use client";

import { bestMatch, type Anchor, type AnchorMatch } from "@/lib/anchor-match";
import type { ObserverId } from "@/lib/types";

// Browser-side copy of the saved visual anchors, plus a tiny bus so the
// dashboard's event stream can ask a specific feed's watcher to capture
// reference views when its observer says "remember this".

export type { Anchor, AnchorMatch, AnchorReference } from "@/lib/anchor-match";
export type CaptureRequest = { observerId: ObserverId; name: string; at: number };

let anchors: Anchor[] = [];
let loaded = false;
const anchorListeners = new Set<(anchors: Anchor[]) => void>();
const captureListeners = new Set<(request: CaptureRequest) => void>();

export function getAnchors() {
  return anchors;
}

export function anchorsLoaded() {
  return loaded;
}

export async function loadAnchors() {
  const response = await fetch("/api/anchors", { cache: "no-store" });
  if (!response.ok) throw new Error(`anchors ${response.status}`);
  const body = (await response.json()) as { anchors: Anchor[] };
  anchors = body.anchors;
  loaded = true;
  anchorListeners.forEach((listener) => listener(anchors));
  return anchors;
}

export function subscribeAnchors(listener: (anchors: Anchor[]) => void) {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}

/** Best anchor for any of the frame's embedding variants, or null if none saved. */
export function matchAnchor(variants: number[][]): AnchorMatch | null {
  return bestMatch(anchors, variants);
}

export function requestAnchorCapture(observerId: ObserverId, name: string) {
  const request = { observerId, name, at: Date.now() };
  captureListeners.forEach((listener) => listener(request));
}

export function onAnchorCapture(listener: (request: CaptureRequest) => void) {
  captureListeners.add(listener);
  return () => {
    captureListeners.delete(listener);
  };
}

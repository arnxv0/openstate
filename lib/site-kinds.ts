// Detector classes (COCO labels from EfficientDet-Lite0) that count as a
// site, and the everyday word used for each in prompts and on the dashboard.
// Anything else a person wants watched is added with "remember this", which
// saves a visual anchor instead of relying on a class.

export const SITE_CLASSES: Record<string, string> = {
  refrigerator: "fridge",
  "dining table": "table",
};

export const DETECTOR_CLASSES = Object.keys(SITE_CLASSES);

/** "dining table" -> "table"; unknown labels pass through lowercased. */
export function siteKind(label: string | null | undefined) {
  if (!label) return null;
  const clean = label.trim().toLowerCase();
  return SITE_CLASSES[clean] ?? clean;
}

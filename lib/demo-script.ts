import type { ObserverId, SpeechState, WorldEvent } from "@/lib/types";

type ObserverPatch = {
  phase?: "offline" | "localizing" | "locked";
  breadcrumb?: string[];
  speech?: SpeechState;
};

export type DemoBeat = {
  atMs: number;
  event?: Omit<WorldEvent, "id" | "timestamp">;
  patch?: Partial<Record<ObserverId, ObserverPatch>>;
};

const HOLD_MS = 8000;

export const DEMO_BEATS: DemoBeat[] = [
  {
    atMs: 800,
    event: {
      type: "system",
      title: "Openstate initialized",
      message: "2 observers connected",
    },
  },
  {
    atMs: 1500,
    event: {
      type: "system",
      title: "Observer connected",
      observerId: "01",
    },
  },
  {
    atMs: 2100,
    event: {
      type: "system",
      title: "Observer connected",
      observerId: "02",
    },
  },
  {
    atMs: 5000,
    event: {
      type: "location",
      title: "Location",
      observerId: "01",
      location: ["Home", "Kitchen"],
    },
    patch: {
      "01": { phase: "locked", breadcrumb: ["Home", "Kitchen"] },
    },
  },
  {
    atMs: 7000,
    event: {
      type: "context",
      title: "Visual anchor identified",
      message: "Refrigerator",
      observerId: "01",
      location: ["Home", "Kitchen", "Refrigerator"],
      confidence: 0.98,
    },
    patch: {
      "01": {
        phase: "locked",
        breadcrumb: ["Home", "Kitchen", "Refrigerator"],
      },
    },
  },
  {
    atMs: 10000,
    patch: {
      "01": { speech: { status: "listening" } },
    },
  },
  {
    atMs: 10600,
    patch: {
      "01": {
        speech: {
          status: "transcript",
          text: "Remember this fridge.",
          intent: "remember",
        },
      },
    },
  },
  {
    atMs: 11200,
    event: {
      type: "voice",
      title: "Voice",
      message: "Remember this fridge.",
      observerId: "01",
      intent: "remember",
    },
  },
  {
    atMs: 12800,
    event: {
      type: "memory",
      title: "Memory zone created",
      message: "Persistent observation enabled",
      observerId: "01",
      location: ["Kitchen", "Refrigerator"],
    },
  },
  {
    atMs: 13400,
    patch: {
      "01": { speech: { status: "idle" } },
    },
  },
  {
    atMs: 15000,
    event: {
      type: "location",
      title: "Location",
      observerId: "02",
      location: ["Home", "Bedroom"],
    },
    patch: {
      "02": { phase: "locked", breadcrumb: ["Home", "Bedroom"] },
    },
  },
  {
    atMs: 17000,
    event: {
      type: "context",
      title: "Visual anchor identified",
      message: "Wardrobe",
      observerId: "02",
      location: ["Home", "Bedroom", "Wardrobe"],
      confidence: 0.93,
    },
    patch: {
      "02": {
        phase: "locked",
        breadcrumb: ["Home", "Bedroom", "Wardrobe"],
      },
    },
  },
  {
    atMs: 18000,
    patch: {
      "02": { speech: { status: "listening" } },
    },
  },
  {
    atMs: 18600,
    patch: {
      "02": {
        speech: {
          status: "transcript",
          text: "Remember my wardrobe.",
          intent: "remember",
        },
      },
    },
  },
  {
    atMs: 19200,
    event: {
      type: "voice",
      title: "Voice",
      message: "Remember my wardrobe.",
      observerId: "02",
      intent: "remember",
    },
  },
  {
    atMs: 20800,
    event: {
      type: "memory",
      title: "Memory zone created",
      message: "Persistent observation enabled",
      observerId: "02",
      location: ["Bedroom", "Wardrobe"],
    },
  },
  {
    atMs: 21400,
    patch: {
      "02": { speech: { status: "idle" } },
    },
  },
  {
    atMs: 28000,
    event: {
      type: "observation",
      title: "Observation",
      message: "Detected in Refrigerator",
      observerId: "01",
      location: ["Home", "Kitchen", "Refrigerator"],
      metadata: {
        items: ["6 eggs", "1 milk", "2 apples"],
      },
    },
  },
  {
    atMs: 36000,
    event: {
      type: "state",
      title: "State change",
      observerId: "01",
      location: ["Kitchen", "Refrigerator"],
      confidence: 0.94,
      metadata: {
        object: "Eggs",
        from: "6",
        to: "4",
      },
    },
  },
  {
    atMs: 44000,
    patch: {
      "02": { speech: { status: "listening" } },
    },
  },
  {
    atMs: 44600,
    patch: {
      "02": {
        speech: {
          status: "transcript",
          text: "Don't remember this.",
          intent: "ignore",
        },
      },
    },
  },
  {
    atMs: 45400,
    event: {
      type: "privacy",
      title: "Privacy control",
      message: "Memory paused for Observer 02",
      observerId: "02",
      metadata: {
        detail: "Visual context discarded",
      },
    },
  },
  {
    atMs: 47200,
    patch: {
      "02": { speech: { status: "idle" } },
    },
  },
  {
    atMs: 52000,
    event: {
      type: "transition",
      title: "Object transition",
      observerId: "02",
      confidence: 0.91,
      metadata: {
        object: "Black Hoodie",
        from: "Wardrobe",
        to: "Observer",
      },
    },
  },
  {
    atMs: 59000,
    patch: {
      "02": { speech: { status: "listening" } },
    },
  },
  {
    atMs: 59600,
    patch: {
      "02": {
        speech: {
          status: "transcript",
          text: "This is the laundry basket.",
          intent: "context",
        },
      },
    },
  },
  {
    atMs: 60400,
    event: {
      type: "voice",
      title: "Voice",
      message: "This is the laundry basket.",
      observerId: "02",
      intent: "context",
    },
  },
  {
    atMs: 62000,
    event: {
      type: "transition",
      title: "Object transition",
      observerId: "02",
      location: ["Home", "Bedroom", "Laundry Basket"],
      confidence: 0.9,
      metadata: {
        object: "Black Hoodie",
        from: "Observer",
        to: "Laundry Basket",
        state: "Dirty",
      },
    },
    patch: {
      "02": {
        phase: "locked",
        breadcrumb: ["Home", "Bedroom", "Laundry Basket"],
        speech: { status: "idle" },
      },
    },
  },
];

export const LOOP_MS =
  Math.max(...DEMO_BEATS.map((beat) => beat.atMs)) + HOLD_MS;

export const FADE_MS = 700;

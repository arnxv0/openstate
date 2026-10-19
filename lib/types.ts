export type ObserverId = "01" | "02";

export type EventType =
  | "system"
  | "location"
  | "context"
  | "voice"
  | "memory"
  | "observation"
  | "state"
  | "transition"
  | "privacy"
  | "answer"
  /** One line of the agents talking to each other (lib/company/transcript.ts). */
  | "agent";

export type SpeechIntent = "neutral" | "remember" | "ignore" | "context";

export type SpeechState =
  | { status: "idle" }
  | { status: "listening" }
  | { status: "transcript"; text: string; intent: SpeechIntent };

type ObserverPhase = "offline" | "idle" | "localizing" | "locked";

export type EventMetadata = {
  items?: string[];
  from?: string;
  to?: string;
  object?: string;
  state?: string;
  detail?: string;
  question?: string;
  latencyMs?: number;
  /** Key of a saved visual anchor this event created or matched. */
  anchor?: string;
  /** Cosine similarity to the matched anchor, 0..1. */
  similarity?: number;
};

export type WorldEvent = {
  id: string;
  timestamp: string;
  observerId?: ObserverId;
  type: EventType;
  title: string;
  message?: string;
  location?: string[];
  confidence?: number;
  intent?: SpeechIntent;
  metadata?: EventMetadata;
};

export type Observer = {
  id: ObserverId;
  name?: string;
  status: "online" | "offline";
  phase: ObserverPhase;
  breadcrumb: string[];
  speech: SpeechState;
  videoUrl: string;
};

export type VoiceState =
  | "off"
  | "connecting"
  | "sleeping"
  | "awake"
  | "thinking"
  | "speaking"
  | "error";

export type VoiceSnapshot = {
  observerId: ObserverId;
  state: VoiceState;
  partial: string;
  question: string;
  answer: string;
  at: number;
};

export type EventWeight = "quiet" | "contextual" | "milestone";

export function eventWeight(type: EventType): EventWeight {
  if (type === "system" || type === "location") return "quiet";
  if (type === "state" || type === "transition") return "milestone";
  return "contextual";
}

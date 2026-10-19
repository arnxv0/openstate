import { EventEmitter } from "node:events";
import type { ObserverId, VoiceSnapshot } from "@/lib/types";

const STALE_MS = 30000;

type Bus = {
  emitter: EventEmitter;
  latest: Map<ObserverId, VoiceSnapshot>;
};

const globalBus = globalThis as typeof globalThis & { __openstateVoiceBus?: Bus };

function bus() {
  globalBus.__openstateVoiceBus ??= {
    emitter: new EventEmitter().setMaxListeners(100),
    latest: new Map(),
  };
  return globalBus.__openstateVoiceBus;
}

export function publishVoice(snapshot: VoiceSnapshot) {
  const { emitter, latest } = bus();
  latest.set(snapshot.observerId, snapshot);
  emitter.emit("voice", snapshot);
}

export function currentVoices() {
  const now = Date.now();
  return [...bus().latest.values()].filter((snapshot) => now - snapshot.at < STALE_MS);
}

export function onVoice(listener: (snapshot: VoiceSnapshot) => void) {
  const { emitter } = bus();
  emitter.on("voice", listener);
  return () => {
    emitter.off("voice", listener);
  };
}

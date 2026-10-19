"use client";

import { useEffect, useState } from "react";
import { loadAnchors, requestAnchorCapture } from "@/lib/anchor-bank";
import { clog } from "@/lib/client-log";
import { cloneObservers } from "@/lib/observers";
import type { Observer, ObserverId, VoiceSnapshot, WorldEvent } from "@/lib/types";

const ANSWER_LINGER_MS = 10000;
const MAX_EVENTS = 80;
const POLL_MS = 1500;

export type LiveVoices = Partial<Record<ObserverId, VoiceSnapshot>>;

function liveObservers(): Observer[] {
  return cloneObservers().map((observer) => ({
    ...observer,
    phase: "idle",
    breadcrumb: [],
  }));
}

function nowClock() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

const ACTIVE = new Set(["awake", "thinking", "speaking"]);

export function useLiveWorld(enabled: boolean) {
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [observers] = useState<Observer[]>(liveObservers);
  const [voices, setVoices] = useState<LiveVoices>({});
  const [clock, setClock] = useState("--:--:--");
  const [latency, setLatency] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const tick = window.setInterval(() => setClock(nowClock()), 500);

    const ping = async () => {
      try {
        const health = (await (await fetch("/api/health")).json()) as {
          pingMs?: number;
        };
        if (health.pingMs !== undefined) setLatency(health.pingMs);
      } catch {}
    };
    ping();
    const pinger = window.setInterval(ping, 10000);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(pinger);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const shown = new Map<ObserverId, VoiceSnapshot>();
    const lingerTimers = new Map<ObserverId, number>();

    const show = (id: ObserverId, snapshot?: VoiceSnapshot) => {
      if (snapshot) shown.set(id, snapshot);
      else shown.delete(id);
      setVoices(Object.fromEntries(shown) as LiveVoices);
    };

    const onVoice = (snapshot: VoiceSnapshot) => {
      const id = snapshot.observerId;
      window.clearTimeout(lingerTimers.get(id));
      if (ACTIVE.has(snapshot.state)) {
        show(id, snapshot);
        return;
      }
      const previous = shown.get(id);
      if (previous && previous.state !== "awake" && snapshot.answer) {
        show(id, { ...snapshot, state: "sleeping" });
        lingerTimers.set(
          id,
          window.setTimeout(() => show(id), ANSWER_LINGER_MS),
        );
      } else {
        show(id);
      }
    };

    const add = (event: WorldEvent) => {
      setEvents((current) =>
        current.some((existing) => existing.id === event.id)
          ? current
          : [...current, event].slice(-MAX_EVENTS),
      );
    };

    // Anchor bookkeeping rides on the same stream: a saved/updated anchor
    // refreshes every dashboard's bank, and a "remember this" from a phone
    // asks that feed's watcher (on the lease-holding dashboard) to capture
    // reference views.
    const onAnchorEvent = (event: WorldEvent) => {
      if (event.metadata?.anchor) loadAnchors().catch(() => {});
      if (event.metadata?.detail === "anchor-request" && event.observerId && event.metadata.object) {
        requestAnchorCapture(event.observerId, event.metadata.object);
      }
    };
    loadAnchors().catch(() => {});

    // Events arrive two ways: pushed on the stream, and polled. Some tunnels
    // buffer the stream, and without it the dashboard would show no chat and
    // never hear "remember this" (so no visual anchor would be captured).
    // `handled` keeps an event from being acted on twice; events already
    // there when the page loaded are shown but not acted on.
    const handled = new Set<string>();
    let loaded = false;
    const receive = (event: WorldEvent) => {
      add(event);
      if (handled.has(event.id)) return;
      handled.add(event.id);
      if (loaded) onAnchorEvent(event);
    };
    const lastVoice = new Map<ObserverId, string>();
    const receiveVoice = (snapshot: VoiceSnapshot) => {
      const signature = JSON.stringify(snapshot);
      if (lastVoice.get(snapshot.observerId) === signature) return;
      lastVoice.set(snapshot.observerId, signature);
      onVoice(snapshot);
    };

    let pollTimer = 0;
    let streamed = 0;
    const poll = async () => {
      try {
        const body = (await (await fetch("/api/events", { cache: "no-store" })).json()) as {
          events: WorldEvent[];
          voices?: VoiceSnapshot[];
        };
        if (cancelled) return;
        const missed = body.events.filter((event) => !handled.has(event.id)).length;
        if (loaded && missed > 0 && streamed === 0 && !warned) {
          warned = true;
          clog("events", "event stream is not delivering; relying on polling", { missed });
        }
        body.events.forEach(receive);
        body.voices?.forEach(receiveVoice);
        loaded = true;
      } catch {
        // The next poll retries.
      }
      if (!cancelled) pollTimer = window.setTimeout(poll, POLL_MS);
    };
    let warned = false;
    poll();

    const source = new EventSource("/api/stream");
    source.onmessage = (message) => {
      streamed += 1;
      receive(JSON.parse(message.data) as WorldEvent);
    };
    source.addEventListener("voice", (message) =>
      receiveVoice(JSON.parse((message as MessageEvent<string>).data) as VoiceSnapshot),
    );

    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
      source.close();
      lingerTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [enabled]);

  return { events, observers, voices, clock, latency, fading: false };
}

"use client";

import { useEffect, useState } from "react";
import { DEMO_BEATS, FADE_MS, LOOP_MS } from "@/lib/demo-script";
import { cloneObservers } from "@/lib/observers";
import { demoLatency, formatDemoClock } from "@/lib/time";
import type { Observer, WorldEvent } from "@/lib/types";

export function useWorldState(enabled = true) {
  const [cycle, setCycle] = useState(0);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [observers, setObservers] = useState<Observer[]>(cloneObservers);
  const [elapsed, setElapsed] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const origin = performance.now();
    const timers: number[] = [];

    const schedule = (ms: number, run: () => void) => {
      timers.push(window.setTimeout(run, ms));
    };

    schedule(0, () => setElapsed(0));

    const clock = window.setInterval(() => {
      setElapsed(performance.now() - origin);
    }, 250);

    for (const beat of DEMO_BEATS) {
      schedule(beat.atMs, () => {
        if (beat.event) {
          const event: WorldEvent = {
            ...beat.event,
            id: `${cycle}-${beat.atMs}-${beat.event.type}`,
            timestamp: formatDemoClock(beat.atMs),
          };
          setEvents((current) => [...current, event]);
        }

        if (beat.patch) {
          setObservers((current) =>
            current.map((observer) => {
              const patch = beat.patch?.[observer.id];
              return patch ? { ...observer, ...patch } : observer;
            }),
          );
        }
      });
    }

    schedule(LOOP_MS, () => setFading(true));
    schedule(LOOP_MS + FADE_MS, () => {
      setFading(false);
      setEvents([]);
      setObservers(cloneObservers());
      setElapsed(0);
      setCycle((current) => current + 1);
    });

    return () => {
      window.clearInterval(clock);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [cycle, enabled]);

  return {
    events,
    observers,
    clock: formatDemoClock(elapsed),
    latency: demoLatency(elapsed),
    fading,
  };
}

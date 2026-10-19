"use client";

import { useEffect, useRef } from "react";
import { ContextualEvent } from "@/components/openstate/events/ContextualEvent";
import { MilestoneEvent } from "@/components/openstate/events/MilestoneEvent";
import { QuietEvent } from "@/components/openstate/events/QuietEvent";
import type { LiveVoices } from "@/lib/use-live-world";
import { eventWeight, type VoiceSnapshot, type WorldEvent } from "@/lib/types";

function PendingVoice({ voice }: { voice: VoiceSnapshot }) {
  const listening = voice.state === "awake";
  return (
    <li className="event-enter grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] gap-x-3">
      <span className="pt-0.5 font-mono text-[11px] text-voice/70">LIVE</span>
      <span className="pt-0.5 font-mono text-[10px] tracking-wide text-white/40">
        {voice.observerId}
      </span>
      <div className="min-w-0 border-l border-voice/40 py-1 pl-5">
        <p className="flex items-center gap-2 text-[10px] tracking-[0.18em] text-voice uppercase">
          <span className="live-dot" aria-hidden />
          {listening ? "Listening" : "Thinking"}
        </p>
        <p className="mt-2 text-[15px] leading-6 text-white/80">
          {listening ? voice.partial || "\u2026" : `\u201c${voice.question}\u201d`}
        </p>
      </div>
    </li>
  );
}

function restingOpacity(index: number, total: number) {
  const distance = total - 1 - index;
  if (distance <= 0) return 1;
  return Math.max(0.62, 1 - distance * 0.04);
}

export function ContextStream({
  events,
  fading,
  voices,
  emptyHint,
}: {
  events: WorldEvent[];
  fading: boolean;
  voices: LiveVoices;
  emptyHint: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pending = Object.values(voices).filter(
    (voice) => voice.state === "awake" || voice.state === "thinking",
  );
  const lastId = `${events.at(-1)?.id}:${pending.map((voice) => voice.state + voice.partial).join("|")}`;

  useEffect(() => {
    const node = scroller.current;
    if (!node || (events.length === 0 && pending.length === 0)) return;

    const align = () => {
      node.scrollTop = node.scrollHeight;
    };

    align();
    const frame = window.requestAnimationFrame(align);
    return () => window.cancelAnimationFrame(frame);
  }, [events.length, pending.length, lastId]);

  return (
    <section
      aria-label="Context stream"
      className={`flex h-full min-h-0 flex-col transition-opacity duration-700 ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="px-7 pt-5 pb-1 sm:px-8">
        <p className="text-[11px] tracking-[0.2em] text-white/40">CONTEXT STREAM</p>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="stream-scroll h-full overflow-y-auto">
          {events.length === 0 && pending.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <p className="text-[11px] tracking-[0.22em] text-white/45">
                LIVE CONTEXT
              </p>
              <p className="mt-3 max-w-md text-[15px] text-white/75">{emptyHint}</p>
              <p className="mt-2 font-mono text-[11px] text-white/35">
                2 observers connected
              </p>
            </div>
          ) : (
            <div className="flex min-h-full flex-col justify-end">
              <ol aria-live="polite" className="flex flex-col gap-6 px-7 pt-4 pb-8 sm:px-8">
                {events.map((event, index) => {
                  const opacity = restingOpacity(index, events.length);
                  const weight = eventWeight(event.type);
                  if (weight === "quiet") {
                    return (
                      <QuietEvent key={event.id} event={event} opacity={opacity} />
                    );
                  }
                  if (weight === "milestone") {
                    return (
                      <MilestoneEvent
                        key={event.id}
                        event={event}
                        opacity={opacity}
                      />
                    );
                  }
                  return (
                    <ContextualEvent
                      key={event.id}
                      event={event}
                      opacity={opacity}
                    />
                  );
                })}
                {pending.map((voice) => (
                  <PendingVoice key={`pending-${voice.observerId}`} voice={voice} />
                ))}
              </ol>
            </div>
          )}
        </div>
        {events.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-ink to-transparent" />
        ) : null}
      </div>
    </section>
  );
}

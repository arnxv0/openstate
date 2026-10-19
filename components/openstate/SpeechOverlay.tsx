"use client";

import { useEffect, useState } from "react";
import type { SpeechIntent, SpeechState } from "@/lib/types";

const intentClass: Record<SpeechIntent | "neutral", string> = {
  neutral: "border-white/15 bg-black/55 text-white/90",
  remember: "border-memory/45 bg-black/60 text-white",
  ignore: "border-white/10 bg-black/40 text-white/45",
  context: "border-location/35 bg-black/55 text-white/85",
};

const intentLabel: Record<SpeechIntent, string | null> = {
  neutral: null,
  remember: "Remember",
  ignore: "Ignore",
  context: "Context",
};

function speechKey(speech: SpeechState) {
  if (speech.status === "transcript") {
    return `${speech.status}:${speech.intent}:${speech.text}`;
  }
  return speech.status;
}

export function SpeechOverlay({ speech }: { speech: SpeechState }) {
  const [shown, setShown] = useState(speech);

  if (speech.status !== "idle" && speechKey(speech) !== speechKey(shown)) {
    setShown(speech);
  }

  useEffect(() => {
    if (speech.status !== "idle") return;
    const timeout = window.setTimeout(() => {
      setShown({ status: "idle" });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [speech]);

  if (shown.status === "idle") return null;

  const open = speech.status !== "idle";
  const intent = shown.status === "transcript" ? shown.intent : "neutral";
  const label = intentLabel[intent];

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6">
      <div
        data-open={open}
        className={`speech-overlay max-w-[15rem] border px-3.5 py-2 text-center ${intentClass[intent]}`}
      >
        {shown.status === "listening" ? (
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/65">
            Listening...
          </p>
        ) : (
          <>
            {label && (
              <p className="mb-1 text-[9px] tracking-[0.2em] uppercase opacity-70">
                {label}
              </p>
            )}
            <p className="text-[13px] leading-5">“{shown.text}”</p>
          </>
        )}
      </div>
    </div>
  );
}

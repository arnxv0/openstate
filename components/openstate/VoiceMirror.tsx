import type { VoiceSnapshot, VoiceState } from "@/lib/types";

const label: Partial<Record<VoiceState, string>> = {
  awake: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  sleeping: "Answered",
};

export function VoiceMirror({ voice }: { voice?: VoiceSnapshot }) {
  if (!voice) return null;
  const listening = voice.state === "awake";

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-12 z-30">
      <section
        aria-live="polite"
        className="speech-overlay border border-white/10 bg-black/55 p-3.5 backdrop-blur-md"
        data-open
      >
        <p
          className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase ${listening ? "text-voice" : "text-white/60"}`}
        >
          {listening || voice.state === "speaking" ? (
            <span className="live-dot" aria-hidden />
          ) : null}
          {label[voice.state] ?? voice.state}
        </p>
        {listening ? (
          <p className="mt-2 text-[14px] leading-5 text-white/70">
            {voice.partial || "\u2026"}
          </p>
        ) : null}
        {!listening && voice.question ? (
          <p className="mt-2 text-[12px] leading-5 text-white/50">
            {"\u201c"}
            {voice.question}
            {"\u201d"}
          </p>
        ) : null}
        {!listening && voice.answer ? (
          <p className="mt-1 text-[15px] leading-6 text-white">{voice.answer}</p>
        ) : null}
      </section>
    </div>
  );
}

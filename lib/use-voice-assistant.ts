"use client";

import { clog } from "@/lib/client-log";
import {
  CommitStrategy,
  RealtimeEvents,
  Scribe,
  type RealtimeConnection,
} from "@elevenlabs/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ObserverId, VoiceState } from "@/lib/types";
import { hasWords, matchWake } from "@/lib/wake";
import { SIGNAL_HEADERS } from "@/lib/webrtc";

export type { VoiceState };

export type VoiceEngine = "elevenlabs" | "browser";

const AWAKE_WINDOW_MS = 9000;

type Ear = { mute(): void; unmute(): void; close(): void };

type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type RecognitionCtor = new () => BrowserRecognition;

function browserRecognition(): RecognitionCtor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function useVoiceAssistant({
  observerId,
  captureFrame,
}: {
  observerId: ObserverId;
  captureFrame: () => string | undefined;
}) {
  const [state, setState] = useState<VoiceState>("off");
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const [partial, setPartial] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<VoiceState>("off");
  const earRef = useRef<Ear | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const awakeTimer = useRef(0);
  const activeRef = useRef(false);
  const captureRef = useRef(captureFrame);
  useEffect(() => {
    captureRef.current = captureFrame;
  }, [captureFrame]);

  const go = useCallback((next: VoiceState) => {
    // "awake" is the wake phrase being heard; the rest trace one exchange.
    if (stateRef.current !== next) clog("voice", "state", { from: stateRef.current, to: next });
    stateRef.current = next;
    setState(next);
  }, []);

  const chime = useCallback((frequency: number) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }, []);

  const speak = useCallback(async (text: string) => {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: SIGNAL_HEADERS,
      body: JSON.stringify({ text }),
    }).catch(() => null);
    const ctx = audioRef.current;

    if (response?.ok && ctx) {
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => resolve();
        source.start();
      });
      return;
    }

    if ("speechSynthesis" in window) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    }
  }, []);

  const ask = useCallback(
    async (text: string) => {
      window.clearTimeout(awakeTimer.current);
      go("thinking");
      earRef.current?.mute();
      setQuestion(text);
      setAnswer("");
      setPartial("");

      let reply = "";
      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: SIGNAL_HEADERS,
          body: JSON.stringify({ observerId, text, image: captureRef.current() }),
        });
        const body = (await response.json()) as { answer?: string; error?: string };
        reply = body.answer ?? body.error ?? "Something went wrong.";
        clog("voice", "asked", { observer: observerId, text, status: response.status, reply, error: body.error });
      } catch (cause) {
        clog("voice", "ask failed to reach the server", { observer: observerId, text, error: String(cause).slice(0, 200) });
        reply = "I couldn't reach OPENSTATE.";
      }

      setAnswer(reply);
      if (!activeRef.current) return;
      go("speaking");
      await speak(reply).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!activeRef.current) return;
      go("sleeping");
      earRef.current?.unmute();
    },
    [go, observerId, speak],
  );

  const wake = useCallback(() => {
    if (stateRef.current !== "awake") {
      chime(880);
      go("awake");
    }
    window.clearTimeout(awakeTimer.current);
    awakeTimer.current = window.setTimeout(() => {
      if (stateRef.current === "awake") {
        setPartial("");
        go("sleeping");
      }
    }, AWAKE_WINDOW_MS);
  }, [chime, go]);

  const hear = useCallback(
    (text: string) => {
      const current = stateRef.current;
      if (current === "thinking" || current === "speaking") return;

      const { woke, rest } = matchWake(text);
      if (!woke && current !== "awake") return;

      const question = woke ? rest : text.trim();
      if (hasWords(question)) ask(question);
      else if (woke) wake();
    },
    [ask, wake],
  );

  const hearPartial = useCallback(
    (text: string) => {
      const current = stateRef.current;
      if (current === "thinking" || current === "speaking") return;
      setPartial(text);
      if (current === "sleeping" && matchWake(text).woke) wake();
    },
    [wake],
  );

  const connectBrowser = useCallback((): Ear | null => {
    const Recognition = browserRecognition();
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let muted = false;
    let closed = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) hear(result[0].transcript);
        else hearPartial(result[0].transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") setError("Microphone permission denied.");
    };
    recognition.onend = () => {
      if (!closed && !muted) {
        try {
          recognition.start();
        } catch {}
      }
    };
    recognition.start();

    return {
      mute() {
        muted = true;
        recognition.stop();
      },
      unmute() {
        muted = false;
        try {
          recognition.start();
        } catch {}
      },
      close() {
        closed = true;
        recognition.stop();
      },
    };
  }, [hear, hearPartial]);

  const connectScribe = useCallback(async (): Promise<Ear | null> => {
    let connection: RealtimeConnection | null = null;
    let muted = false;
    let closed = false;

    const fetchToken = async () => {
      const response = await fetch("/api/voice/token", {
        method: "POST",
        headers: SIGNAL_HEADERS,
      });
      if (response.status === 503) return null;
      if (!response.ok) throw new Error(`Voice token failed (${response.status})`);
      return ((await response.json()) as { token: string }).token;
    };

    const open = (token: string) => {
      const current = Scribe.connect({
        token,
        modelId: "scribe_v2_realtime",
        languageCode: "en",
        commitStrategy: CommitStrategy.VAD,
        vadSilenceThresholdSecs: 0.9,
        keyterms: ["Hey World", "OPENSTATE"],
        noVerbatim: true,
        microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      connection = current;

      current.on(RealtimeEvents.SESSION_STARTED, () => {
        if (muted) {
          try {
            current.mute();
          } catch {}
        }
      });
      current.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => hearPartial(data.text));
      current.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => hear(data.text));
      current.on(RealtimeEvents.ERROR, (data) => {
        const detail = data as { error?: string; message?: string };
        setError(detail.error ?? detail.message ?? "Transcription error");
      });
      current.on(RealtimeEvents.CLOSE, () => {
        if (closed || connection !== current || !activeRef.current) return;
        connection = null;
        window.setTimeout(() => {
          if (closed || !activeRef.current) return;
          fetchToken()
            .then((next) => next && open(next))
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : "Voice reconnect failed"),
            );
        }, 1000);
      });
    };

    const token = await fetchToken();
    if (!token) return null;
    open(token);

    return {
      mute() {
        muted = true;
        try {
          connection?.mute();
        } catch {}
      },
      unmute() {
        muted = false;
        try {
          connection?.unmute();
        } catch {}
      },
      close() {
        closed = true;
        connection?.close();
        connection = null;
      },
    };
  }, [hear, hearPartial]);

  const unlockAudio = useCallback(() => {
    audioRef.current ??= new AudioContext();
    audioRef.current.resume().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setError(null);
    go("connecting");
    unlockAudio();

    try {
      const scribe = await connectScribe();
      if (scribe) {
        earRef.current = scribe;
        setEngine("elevenlabs");
      } else {
        const browser = connectBrowser();
        if (!browser) throw new Error("No speech recognition available on this browser.");
        earRef.current = browser;
        setEngine("browser");
      }
      go("sleeping");
    } catch (cause) {
      activeRef.current = false;
      clog("voice", "failed to start", { observer: observerId, error: String(cause).slice(0, 200) });
      go("error");
      setError(cause instanceof Error ? cause.message : "Microphone unavailable");
    }
  }, [connectBrowser, connectScribe, go, observerId, unlockAudio]);

  const outbox = useRef<{ busy: boolean; next: string | null }>({ busy: false, next: null });

  useEffect(() => {
    if (state === "off") return;
    const box = outbox.current;
    box.next = JSON.stringify({ observerId, state, partial, question, answer });
    if (box.busy) return;

    const flush = async () => {
      box.busy = true;
      while (box.next) {
        const body = box.next;
        box.next = null;
        await fetch("/api/voice/state", {
          method: "POST",
          headers: SIGNAL_HEADERS,
          body,
        }).catch(() => {});
      }
      box.busy = false;
    };
    flush();
  }, [observerId, state, partial, question, answer]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      window.clearTimeout(awakeTimer.current);
      earRef.current?.close();
      audioRef.current?.close().catch(() => {});
    };
  }, []);

  return { state, engine, partial, question, answer, error, start, unlockAudio };
}

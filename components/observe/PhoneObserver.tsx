"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clog } from "@/lib/client-log";
import type { PhonePoll, ViewerOffer } from "@/lib/signal-store";
import type { ObserverId } from "@/lib/types";
import { useVoiceAssistant, type VoiceState } from "@/lib/use-voice-assistant";
import { WAKE_PHRASE } from "@/lib/wake";
import {
  RTC_CONFIG,
  SIGNAL_HEADERS,
  signalUrl,
  waitForIceGathering,
} from "@/lib/webrtc";

type Status =
  | "idle"
  | "starting"
  | "waiting"
  | "connected"
  | "busy"
  | "error";

const statusCopy: Record<Status, string> = {
  idle: "Ready",
  starting: "Opening camera...",
  waiting: "Waiting for dashboard...",
  connected: "Streaming to OPENSTATE",
  busy: "Another device is streaming as this observer",
  error: "Camera unavailable",
};

const voiceCopy: Record<VoiceState, string> = {
  off: "",
  connecting: "Opening microphone...",
  sleeping: `Say \u201c${WAKE_PHRASE}\u201d`,
  awake: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking",
  error: "Voice unavailable",
};

const FRAME_WIDTH = 768;
// Relayed video: small and slow enough for a tunnel, enough for detection.
const RELAY_WIDTH = 480;
const RELAY_QUALITY = 0.5;
// About 10 frames a second when the tunnel keeps up.
const RELAY_EVERY_MS = 100;
const RELAY_PARALLEL = 3;
const CAMERA_WARMUP_MS = 1500;

export function PhoneObserver({ observerId }: { observerId: ObserverId }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [relaying, setRelaying] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(FRAME_WIDTH, video.videoWidth);
    canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }, []);

  const voice = useVoiceAssistant({ observerId, captureFrame });

  useEffect(() => {
    const stream = streamRef.current;
    if (attempt === 0 || !stream) return;

    let stopped = false;
    let pollTimer = 0;
    const session = crypto.randomUUID();
    const viewers = new Map<string, { offerId: string; pc: RTCPeerConnection }>();

    const refreshStatus = () => {
      const states = [...viewers.values()].map((v) => v.pc.connectionState);
      setStatus(states.includes("connected") ? "connected" : "waiting");
    };

    const answer = async ({ viewer, offerId, offer }: ViewerOffer) => {
      viewers.get(viewer)?.pc.close();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      viewers.set(viewer, { offerId, pc });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onconnectionstatechange = () => {
        if (stopped) return;
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          if (viewers.get(viewer)?.pc === pc) viewers.delete(viewer);
          pc.close();
        }
        refreshStatus();
      };

      await pc.setRemoteDescription({ type: "offer", sdp: offer });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc);
      if (stopped || viewers.get(viewer)?.pc !== pc) return;

      await fetch(signalUrl(observerId), {
        method: "POST",
        headers: SIGNAL_HEADERS,
        body: JSON.stringify({
          kind: "answer",
          session,
          viewer,
          offerId,
          sdp: pc.localDescription?.sdp,
        }),
      });
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(
          `${signalUrl(observerId)}?session=${session}`,
          { cache: "no-store", headers: SIGNAL_HEADERS },
        );
        const { offers, busy } = (await response.json()) as PhonePoll;
        if (busy) setStatus("busy");
        else if (viewers.size === 0) setStatus("waiting");
        for (const entry of offers) {
          if (viewers.get(entry.viewer)?.offerId === entry.offerId) continue;
          answer(entry).catch(() => {
            if (viewers.get(entry.viewer)?.offerId === entry.offerId) {
              viewers.get(entry.viewer)?.pc.close();
              viewers.delete(entry.viewer);
            }
          });
        }
      } catch {
        // Keep polling through brief network drops.
      }
      if (!stopped) pollTimer = window.setTimeout(poll, 800);
    };

    setStatus("waiting");
    poll();

    const release = () => {
      fetch(`${signalUrl(observerId)}?session=${session}`, {
        method: "DELETE",
        headers: SIGNAL_HEADERS,
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", release);

    return () => {
      stopped = true;
      window.clearTimeout(pollTimer);
      window.removeEventListener("pagehide", release);
      viewers.forEach((viewer) => viewer.pc.close());
      release();
    };
  }, [attempt, observerId]);

  // When no dashboard is connected over WebRTC (blocked by the network, or
  // still negotiating), send frames through the server instead. The same
  // HTTPS tunnel that served this page carries them, so it works anywhere the
  // page loads. Stops as soon as a direct connection is up.
  useEffect(() => {
    if (attempt === 0 || status === "connected" || status === "busy" || status === "error") return;
    let stopped = false;
    let timer = 0;
    let relayFailures = 0;
    let relayAnnounced = false;
    const canvas = document.createElement("canvas");
    let inFlight = 0;
    const relayStartedAt = performance.now();
    // Frames are sent on a fixed beat, with up to RELAY_PARALLEL uploads in
    // the air at once, so a slow round trip through the tunnel does not cap
    // the rate. Each carries its capture time; the server drops late arrivals.
    const send = async () => {
      const video = videoRef.current;
      // The first second after the camera opens is black, then tinted while
      // exposure and white balance settle; those frames are not sent.
      if (stopped || !video?.videoWidth || video.readyState < 2 || inFlight >= RELAY_PARALLEL) return;
      if (performance.now() - relayStartedAt < CAMERA_WARMUP_MS) return;
      inFlight += 1;
      try {
        const at = Date.now();
        canvas.width = Math.min(RELAY_WIDTH, video.videoWidth);
        canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", RELAY_QUALITY),
        );
        if (!blob || stopped) return;
        const response = await fetch(`/api/frame/${observerId}`, {
          method: "POST",
          headers: {
            "Content-Type": "image/jpeg",
            "X-Frame-At": String(at),
            "ngrok-skip-browser-warning": "1",
          },
          body: blob,
        });
        if (!stopped) setRelaying(response.ok);
        if (!response.ok && relayFailures++ % 20 === 0) {
          clog("relay", "frame rejected", { observer: observerId, status: response.status, bytes: blob.size });
        }
        if (response.ok) {
          sent += 1;
          bytes += blob.size;
          if (!relayAnnounced) {
            relayAnnounced = true;
            clog("relay", "sending frames through the server", { observer: observerId, bytes: blob.size, width: canvas.width });
          }
        }
      } catch (cause) {
        if (relayFailures++ % 20 === 0) {
          clog("relay", "frame upload failed", { observer: observerId, error: String(cause).slice(0, 200) });
        }
        if (!stopped) setRelaying(false);
      } finally {
        inFlight -= 1;
      }
    };
    let sent = 0;
    let bytes = 0;
    timer = window.setInterval(send, RELAY_EVERY_MS);
    // Actual rate achieved, for the debug log.
    const reporter = window.setInterval(() => {
      if (sent > 0) clog("relay", "rate", { observer: observerId, fps: sent / 10, kbPerSec: Math.round(bytes / 10 / 1024) });
      sent = 0;
      bytes = 0;
    }, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(reporter);
      setRelaying(false);
    };
  }, [attempt, observerId, status]);

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const start = async () => {
    voice.unlockAudio();
    setError(null);
    setStatus("starting");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Open this page over HTTPS to use the camera.");
      return;
    }
    try {
      const video = {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      };
      // Ask for the microphone in the same prompt as the camera: voice opens
      // it a moment later, and a second prompt at that point is easy to miss
      // or dismiss, which leaves "Hey World" silently dead.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
        // Only the permission was needed; video alone is streamed.
        for (const track of stream.getAudioTracks()) {
          track.stop();
          stream.removeTrack(track);
        }
        clog("camera", "microphone permission granted", { observer: observerId });
      } catch (cause) {
        clog("camera", "microphone not granted with the camera, continuing with video only", {
          observer: observerId,
          error: String(cause).slice(0, 200),
        });
        setMicBlocked(true);
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      const settings = stream.getVideoTracks()[0]?.getSettings();
      clog("camera", "started", { observer: observerId, width: settings?.width, height: settings?.height, fps: settings?.frameRate });
      setAttempt((current) => current + 1);
      voice.start();
    } catch (cause) {
      clog("camera", "failed to start", { observer: observerId, error: String(cause).slice(0, 200) });
      setStatus("error");
      setError(
        cause instanceof Error ? cause.message : "Camera permission denied.",
      );
    }
  };

  useEffect(() => {
    if (status !== "idle") clog("camera", "status", { observer: observerId, status });
  }, [observerId, status]);

  const live = status === "connected" || relaying;

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-ink text-foreground">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />

      <header className="relative z-10 flex items-start justify-between p-5">
        <div>
          <p className="text-[13px] tracking-[0.22em] text-white">OPENSTATE</p>
          <p className="mt-1 text-[11px] tracking-[0.18em] text-white/55">
            OBSERVER {observerId}
          </p>
        </div>
        {live ? (
          <p className="flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-white/85">
            <span className="live-dot" aria-hidden />
            LIVE
          </p>
        ) : null}
      </header>

      <div className="relative z-10 mt-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {voice.state !== "off" ? (
          <section
            aria-live="polite"
            className="mb-4 border border-white/10 bg-black/45 p-4 backdrop-blur-md"
          >
            <p
              className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase ${voice.state === "awake" ? "text-voice" : "text-white/60"}`}
            >
              {voice.state === "awake" || voice.state === "speaking" ? (
                <span className="live-dot" aria-hidden />
              ) : null}
              {voiceCopy[voice.state]}
              {voice.engine ? (
                <span className="ml-auto text-white/30">
                  {voice.engine === "elevenlabs" ? "ELEVENLABS" : "BROWSER STT"}
                </span>
              ) : null}
            </p>
            {voice.state === "awake" && voice.partial ? (
              <p className="mt-2 text-[14px] leading-5 text-white/60">{voice.partial}</p>
            ) : null}
            {voice.question ? (
              <p className="mt-3 text-[13px] leading-5 text-white/50">
                {"\u201c"}
                {voice.question}
                {"\u201d"}
              </p>
            ) : null}
            {voice.answer ? (
              <p className="mt-1.5 text-[17px] leading-6 text-white">{voice.answer}</p>
            ) : null}
            {voice.error ? (
              <p className="mt-2 text-[12px] text-white/45">{voice.error}</p>
            ) : null}
          </section>
        ) : null}
        {status === "idle" || status === "error" ? (
          <button
            type="button"
            onClick={start}
            className="w-full border border-white/20 bg-white/[0.06] py-4 text-[12px] tracking-[0.2em] text-white uppercase backdrop-blur-sm active:bg-white/10"
          >
            Start observing
          </button>
        ) : null}
        <p className="mt-3 text-center font-mono text-[11px] tracking-wide text-white/60">
          {relaying && status === "waiting" ? "Streaming to OPENSTATE (relayed)" : statusCopy[status]}
        </p>
        {error ? (
          <p className="mt-1 text-center text-[12px] text-white/45">{error}</p>
        ) : null}
        {micBlocked ? (
          <p className="mt-1 text-center text-[12px] text-live">
            Microphone blocked: allow it for this site in the browser settings, then reload, or “Hey World” will not hear you.
          </p>
        ) : null}
      </div>
    </main>
  );
}

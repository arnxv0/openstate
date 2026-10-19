"use client";

import { useEffect, useState } from "react";
import { clog } from "@/lib/client-log";
import type { ViewerPoll } from "@/lib/signal-store";
import type { ObserverId } from "@/lib/types";
import {
  RTC_CONFIG,
  SIGNAL_HEADERS,
  signalUrl,
  waitForIceGathering,
} from "@/lib/webrtc";

const OBSERVER_IDS: ObserverId[] = ["01", "02"];
const POLL_MS = 1000;
const OFFER_TIMEOUT_MS = 8000;
// Long enough to ride out a few seconds of bad signal without tearing down
// the feed (and the watcher state that goes with it).
const RELAY_FRESH_MS = 8000;

type Link = {
  phoneSession: string;
  offerId: string;
  pc: RTCPeerConnection;
  answered: boolean;
  createdAt: number;
};

export function usePhoneStreams() {
  const [streams, setStreams] = useState<
    Partial<Record<ObserverId, MediaStream>>
  >({});

  useEffect(() => {
    const viewer = crypto.randomUUID();
    const links = new Map<ObserverId, Link>();
    let stopped = false;

    // Relayed frames (see lib/frame-relay.ts) drawn onto a canvas and exposed
    // as a MediaStream, so the feed and the watcher treat them like WebRTC.
    const relays = new Map<ObserverId, { stream: MediaStream; freshAt: number }>();
    const rtcStreams = new Map<ObserverId, MediaStream>();

    // WebRTC when it is actually connected (its track exists before any media
    // flows), otherwise the relay while frames keep arriving.
    const sources = new Map<ObserverId, string>();
    const choose = (id: ObserverId) => {
      const link = links.get(id);
      const relay = relays.get(id);
      const rtc = rtcStreams.get(id);
      let source = "none";
      if (link?.pc.connectionState === "connected" && rtc) {
        source = "webrtc";
        setStream(id, rtc);
      } else if (relay && Date.now() - relay.freshAt < RELAY_FRESH_MS) {
        source = "relay";
        setStream(id, relay.stream);
      } else {
        if (rtc) source = "webrtc (not connected)";
        setStream(id, rtc);
      }
      if (sources.get(id) !== source) {
        sources.set(id, source);
        clog("stream", "video source changed", { observer: id, source, rtc: link?.pc.connectionState ?? "no link" });
      }
    };

    const runRelay = async (id: ObserverId) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      let seq = 0;
      while (!stopped) {
        try {
          const response = await fetch(`/api/frame/${id}?after=${seq}`, {
            cache: "no-store",
            headers: SIGNAL_HEADERS,
          });
          if (response.status === 200 && context) {
            seq = Number(response.headers.get("X-Frame-Seq")) || seq + 1;
            const bitmap = await createImageBitmap(await response.blob());
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const relay = relays.get(id) ?? { stream: canvas.captureStream(), freshAt: 0 };
            relay.freshAt = Date.now();
            relays.set(id, relay);
          } else if (response.status !== 204) {
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
          }
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
        if (!stopped) choose(id);
      }
    };

    const setStream = (id: ObserverId, stream?: MediaStream) => {
      setStreams((current) => {
        if (current[id] === stream) return current;
        const next = { ...current };
        if (stream) next[id] = stream;
        else delete next[id];
        return next;
      });
    };

    const drop = (id: ObserverId) => {
      links.get(id)?.pc.close();
      links.delete(id);
      rtcStreams.delete(id);
      choose(id);
    };

    const offer = async (id: ObserverId, phoneSession: string) => {
      drop(id);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const link: Link = {
        phoneSession,
        offerId: crypto.randomUUID(),
        pc,
        answered: false,
        createdAt: Date.now(),
      };
      links.set(id, link);

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (event) => {
        rtcStreams.set(id, event.streams[0] ?? new MediaStream([event.track]));
        choose(id);
      };
      pc.onconnectionstatechange = () => {
        if (links.get(id) === link) choose(id);
        if (
          links.get(id) === link &&
          (pc.connectionState === "failed" || pc.connectionState === "closed")
        ) {
          drop(id);
        }
      };

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);
      if (stopped || links.get(id) !== link) return;

      await fetch(signalUrl(id), {
        method: "POST",
        headers: SIGNAL_HEADERS,
        body: JSON.stringify({
          kind: "offer",
          viewer,
          offerId: link.offerId,
          phoneSession,
          sdp: pc.localDescription?.sdp,
        }),
      });
    };

    const sync = async (id: ObserverId) => {
      const response = await fetch(`${signalUrl(id)}?viewer=${viewer}`, {
        cache: "no-store",
        headers: SIGNAL_HEADERS,
      });
      const poll = (await response.json()) as ViewerPoll;
      if (stopped) return;

      const link = links.get(id);
      if (!poll.phoneSession) {
        if (link) drop(id);
        return;
      }
      if (!link || link.phoneSession !== poll.phoneSession) {
        await offer(id, poll.phoneSession);
        return;
      }
      if (!link.answered && poll.offerId !== link.offerId) {
        if (Date.now() - link.createdAt > OFFER_TIMEOUT_MS) {
          await offer(id, poll.phoneSession);
        }
        return;
      }
      if (!link.answered && poll.answer) {
        link.answered = true;
        await link.pc.setRemoteDescription({ type: "answer", sdp: poll.answer });
      }
    };

    let timer = 0;
    const poll = async () => {
      await Promise.all(
        OBSERVER_IDS.map((id) =>
          sync(id).catch(() => {
            // Signaling is best-effort; the next poll retries.
          }),
        ),
      );
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    timer = window.setTimeout(poll, 0);
    OBSERVER_IDS.forEach((id) => void runRelay(id));

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      links.forEach((link) => link.pc.close());
      links.clear();
      relays.forEach((relay) => relay.stream.getTracks().forEach((track) => track.stop()));
    };
  }, []);

  return streams;
}

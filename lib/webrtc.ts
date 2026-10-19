import type { ObserverId } from "@/lib/types";

// STUN is enough when phones and laptop can reach each other directly (same
// home wifi or a phone hotspot). Venue wifi with client isolation, or a phone
// on mobile data, needs a TURN relay: set NEXT_PUBLIC_TURN_URLS (comma
// separated), NEXT_PUBLIC_TURN_USERNAME and NEXT_PUBLIC_TURN_CREDENTIAL.
const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
    ...(turnUrls.length
      ? [
          {
            urls: turnUrls,
            username: process.env.NEXT_PUBLIC_TURN_USERNAME,
            credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
          },
        ]
      : []),
  ],
};

export function signalUrl(observerId: ObserverId) {
  return `/api/signal/${observerId}`;
}

export const SIGNAL_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};

export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

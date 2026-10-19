"use client";

import { clog } from "@/lib/client-log";
import { useEffect, useState } from "react";

const RENEW_MS = 3000;

let tabViewer: string | null = null;

function viewerId() {
  tabViewer ??=
    "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return tabViewer;
}

export function useCaptureLease(enabled: boolean) {
  const [lease, setLease] = useState({ viewer: "", leader: false });

  useEffect(() => {
    if (!enabled) return;
    const viewer = viewerId();
    let stopped = false;
    let failures = 0;
    let wasLeader: boolean | null = null;
    const claim = async () => {
      try {
        const response = await fetch("/api/capture/lease", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewer }),
        });
        const { leader } = (await response.json()) as { leader: boolean };
        failures = 0;
        if (wasLeader !== leader) {
          wasLeader = leader;
          clog("lease", leader ? "this tab now captures" : "another tab captures; this one is view only", { viewer });
        }
        if (!stopped) setLease({ viewer, leader });
      } catch {
        // One dropped renewal is a network blip, not a lost lease; giving up
        // capture on it would discard the episode in progress.
        failures += 1;
        if (!stopped && failures >= 2) setLease({ viewer, leader: false });
      }
    };
    claim();
    const timer = window.setInterval(claim, RENEW_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { viewer: lease.viewer, leader: enabled && lease.leader };
}

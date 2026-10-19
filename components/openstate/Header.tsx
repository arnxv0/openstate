"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type HeaderProps = {
  clock: string;
  latency: number;
  latencyLabel?: string;
};

type Usage = { lastHour: { usd: number; calls: number }; total: { usd: number; calls: number } };

const dollars = (usd: number) => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`;

/** Estimated model spend, refreshed every few seconds. */
function useUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const body = (await (await fetch("/api/usage")).json()) as Usage & { error?: string };
        if (!cancelled && !body.error) setUsage(body);
      } catch {}
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return usage;
}

export function Header({ clock, latency, latencyLabel = "LATENCY" }: HeaderProps) {
  const usage = useUsage();
  return (
    <header className="flex h-[76px] shrink-0 items-center justify-between gap-6 border-b border-white/[0.08] px-5 sm:px-7">
      <div>
        <h1 className="text-[15px] font-medium tracking-[0.22em] text-white">
          OPENSTATE
        </h1>
        <p className="mt-1 text-[12px] text-white/45">Shared Spatial Memory</p>
      </div>
      <nav className="hidden items-center gap-6 text-[11px] tracking-[0.16em] sm:flex">
        <Link href="/places" className="text-white/60 hover:text-white">
          PLACES &amp; LOGS
        </Link>
        <span
          className="font-mono tracking-wide text-white/60"
          title="Estimated from tokens used by this app. Calls inside the deployed agent are not included; the provider's billing page is the authority."
        >
          MODEL COST{" "}
          <span className="tabular-nums text-white/90">{usage ? dollars(usage.total.usd) : "—"}</span>
          {usage ? (
            <span className="text-white/35">
              {" "}
              · {dollars(usage.lastHour.usd)} last hour · {usage.total.calls} calls
            </span>
          ) : null}
        </span>
      </nav>
      <div className="text-right">
        <p className="flex items-center justify-end gap-2 text-[11px] tracking-[0.16em] text-white/80">
          <span className="live-dot" aria-hidden />
          SYSTEM ONLINE
        </p>
        <p className="mt-1 font-mono text-[11px] tracking-wide text-white/40">
          2 OBSERVERS
          <span className="px-2 text-white/20">·</span>
          <span className="tabular-nums">{clock}</span>
          <span className="px-2 text-white/20">·</span>
          {latencyLabel} <span className="tabular-nums">{latency}ms</span>
        </p>
      </div>
    </header>
  );
}

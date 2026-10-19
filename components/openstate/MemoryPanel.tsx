"use client";

import { useEffect, useState } from "react";
import { cameraLabel, observerName } from "@/lib/observers";

type SiteView = {
  name: string;
  place: string | null;
  catalogued: boolean;
  items: { name: string; count: number; since: string; by: string }[];
  lastSeen: string;
  lastObserver: string;
  lastChange: { summary: string; by: string; at: string } | null;
};

type TrendView = {
  item: string;
  site: string;
  inStock: number;
  used: number;
  tracked: string;
  perDay: number | null;
  runsOutIn: string | null;
  freshness: string | null;
  buy: "out" | "running low" | null;
};

type State = {
  sites: SiteView[];
  changes: {
    id: string;
    at: string;
    kind: "added" | "removed";
    item: string | null;
    who: string | null;
    detail: string | null;
    observerId: string | null;
    summary: string;
  }[];
  facts: { id: string; at: string; observerId: string | null; text: string }[];
  trends: TrendView[];
  anchors: number;
  processing?: { inFlight: number; expected: number };
};

const REFRESH_MS = 2500;

function Heading({ children, count }: { children: string; count?: number }) {
  return (
    <p className="mt-6 mb-2 flex items-baseline justify-between text-[10px] tracking-[0.18em] text-white/40 uppercase first:mt-0">
      <span>{children}</span>
      {count !== undefined ? <span className="font-mono text-white/30">{count}</span> : null}
    </p>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-[13px] leading-5 text-white/35">{children}</p>;
}

/**
 * What OPENSTATE holds right now: sites and their counted contents, the
 * latest changes, trends and remembered facts. Refetches whenever a new event
 * arrives on the stream (`revision`) and on a slow timer.
 */
export function MemoryPanel({ revision }: { revision: string }) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/state");
        const body = (await response.json()) as State & { error?: string };
        if (cancelled) return;
        if (!response.ok || body.error) throw new Error(body.error);
        setState(body);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [revision]);

  const busy = Boolean(state?.processing && (state.processing.inFlight > 0 || state.processing.expected > 0));
  const tracked = state?.trends.filter((trend) => trend.used > 0 || trend.buy || (trend.freshness && trend.freshness !== "fresh")) ?? [];

  return (
    <section aria-label="Memory" className="flex h-full min-h-0 flex-col border-l border-white/[0.06]">
      <div className="flex items-baseline justify-between px-6 pt-5 pb-1">
        <p className="text-[11px] tracking-[0.2em] text-white/40">MEMORY</p>
        <p className="flex items-center gap-2 font-mono text-[10px] text-white/30">
          {busy ? (
            <span className="flex items-center gap-1.5 text-memory" role="status">
              <span className="spinner" aria-hidden />
              {state?.processing?.inFlight ? "reading what the camera saw" : "watching a change"}
            </span>
          ) : null}
          {!state && !failed ? <span className="spinner" aria-hidden /> : null}
          {failed ? "unreachable" : state ? `${state.sites.length} sites · ${state.anchors} anchors` : "loading"}
        </p>
      </div>
      <div className="stream-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
        <Heading count={state?.sites.length}>Sites</Heading>
        {state && state.sites.length === 0 ? (
          <Empty>Nothing registered yet. Point a phone at a table and say “Hey World, remember this”.</Empty>
        ) : null}
        <ul className="flex flex-col gap-4">
          {state?.sites.map((site) => (
            <li key={site.name} className="rounded-md border border-white/[0.07] bg-panel px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] text-white/90">
                  {site.name}
                  {site.place ? <span className="text-white/40"> · {site.place}</span> : null}
                </p>
                <p className="shrink-0 font-mono text-[10px] text-white/35">
                  {site.lastSeen} · {observerName(site.lastObserver)}
                </p>
              </div>
              {!site.catalogued ? (
                <p className="mt-2 text-[13px] text-white/40">Contents not seen yet</p>
              ) : site.items.length === 0 ? (
                <p className="mt-2 text-[13px] text-white/40">Empty</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {site.items.map((item) => (
                    <li
                      key={item.name}
                      title={`since ${item.since}, last seen changing by ${cameraLabel(item.by)}`}
                      className="rounded border border-white/[0.08] px-2 py-0.5 text-[12px] text-white/75"
                    >
                      {item.name}
                      {item.count > 1 ? <span className="ml-1 font-mono text-memory">×{item.count}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {site.lastChange ? (
                <p className="mt-2.5 font-mono text-[11px] text-change">
                  {site.lastChange.summary}
                  <span className="text-white/35"> · {site.lastChange.at} · {cameraLabel(site.lastChange.by)}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <Heading count={state?.changes.length}>Recent changes</Heading>
        {state && state.changes.length === 0 ? <Empty>No items taken or added yet.</Empty> : null}
        <ul className="flex flex-col gap-1.5">
          {state?.changes.map((change) => (
            <li key={change.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 text-[12px] leading-5">
              <span className="font-mono text-[11px] text-white/35">{change.at}</span>
              <span className="text-white/70">
                <span className={change.kind === "added" ? "text-memory" : "text-change"}>
                  {change.kind === "added" ? "+" : "−"}
                </span>{" "}
                {change.item ?? change.summary}
                {change.detail ? <span className="font-mono text-white/40"> {change.detail}</span> : null}
                {change.who ? <span className="text-white/90"> · taken by {change.who}</span> : null}
                {change.observerId ? (
                  <span className="text-white/35">
                    {" "}
                    · {change.who ? "seen by " : ""}
                    {cameraLabel(change.observerId)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <Heading>Trends</Heading>
        {state && tracked.length === 0 ? (
          <Empty>Pace, time left and what to buy appear once items have been taken.</Empty>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {tracked.map((trend) => (
            <li key={`${trend.site}:${trend.item}`} className="text-[12px] leading-5 text-white/70">
              {trend.item}
              <span className="text-white/35"> · {trend.site}</span>
              <span className="font-mono text-white/45">
                {" "}
                {trend.inStock} left
                {trend.used > 0 ? ` · ${trend.used} used in ${trend.tracked}` : ""}
                {trend.runsOutIn ? ` · out in ~${trend.runsOutIn}` : ""}
              </span>
              {trend.buy ? (
                <span className="ml-2 rounded bg-live/15 px-1.5 py-0.5 font-mono text-[10px] text-live uppercase">
                  {trend.buy === "out" ? "buy" : "low"}
                </span>
              ) : null}
              {trend.freshness && trend.freshness !== "fresh" ? (
                <span className="ml-2 rounded bg-change/15 px-1.5 py-0.5 font-mono text-[10px] text-change uppercase">
                  {trend.freshness}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <Heading count={state?.facts.length}>Remembered</Heading>
        {state && state.facts.length === 0 ? <Empty>Nothing saved by voice yet.</Empty> : null}
        <ul className="flex flex-col gap-2">
          {state?.facts.map((fact) => (
            <li key={fact.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 text-[12px] leading-5">
              <span className="font-mono text-[11px] text-white/35">{fact.at}</span>
              <span className="text-white/70">{fact.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

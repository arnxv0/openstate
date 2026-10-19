"use client";

import { useEffect, useState } from "react";

// The company at work: the six agents (with their Masky faces when
// configured) and the last things they said to each other.

type Agent = { key: string; name: string; title: string; brief: string; color: string };
type Avatar = { key: string; name: string; imageUrl?: string; liveUrl?: string | null };
type Line = { id: string; at: string; from: string; to: string; text: string; tools?: string[]; ms?: number };
type Company = {
  roster: Agent[];
  avatars: Avatar[];
  band: { configured: boolean; participants?: unknown[] | number; error?: string };
  transcript: Line[];
};

const POLL_MS = 3000;

export function CompanyPanel() {
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/company?limit=40");
        if (response.ok && !cancelled) setCompany((await response.json()) as Company);
      } catch {
        // Keep the last good state; the next poll will try again.
      }
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const byKey = new Map(company?.roster.map((agent) => [agent.key, agent]));
  const avatarOf = new Map(company?.avatars.map((avatar) => [avatar.key, avatar]));
  const nameOf = (key: string) => (key === "user" ? "household" : key === "all" ? "everyone" : (byKey.get(key)?.name ?? key));

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.03]">
      <header className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/50">
        <span>The company</span>
        <span className="normal-case tracking-normal text-white/40">
          {company?.band.configured
            ? `BAND room · ${Array.isArray(company.band.participants) ? company.band.participants.length : (company.band.participants ?? "?")} in`
            : "BAND off"}
        </span>
      </header>
      <div className="flex flex-wrap gap-2 px-3 pb-2">
        {(company?.roster ?? []).map((agent) => {
          const avatar = avatarOf.get(agent.key);
          return (
            <div key={agent.key} className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 py-1 pr-3 pl-1" title={agent.brief}>
              {avatar?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar.imageUrl} alt={agent.name} className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-black" style={{ background: agent.color }}>
                  {agent.name[0]}
                </span>
              )}
              <span className="text-xs text-white/85">{agent.name}</span>
              <span className="text-[10px] text-white/40">{agent.title}</span>
            </div>
          );
        })}
      </div>
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3 text-xs">
        {company?.transcript.length ? (
          company.transcript
            .slice()
            .reverse()
            .map((line) => (
              <li key={line.id} className="rounded-lg bg-black/25 px-2.5 py-1.5">
                <div className="flex items-baseline gap-1.5 text-[11px]">
                  <span className="font-semibold" style={{ color: byKey.get(line.from)?.color ?? "#fff" }}>
                    {nameOf(line.from)}
                  </span>
                  <span className="text-white/35">→ {nameOf(line.to)}</span>
                  {line.tools?.length ? <span className="text-white/35">· {line.tools.join(", ")}</span> : null}
                  {line.ms ? <span className="ml-auto text-white/30">{(line.ms / 1000).toFixed(1)}s</span> : null}
                </div>
                <p className="mt-0.5 text-white/80">{line.text}</p>
              </li>
            ))
        ) : (
          <li className="px-1 py-2 text-white/40">Nothing said yet. Ask something on an observer phone.</li>
        )}
      </ol>
    </section>
  );
}

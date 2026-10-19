"use client";

/* eslint-disable @next/next/no-img-element -- frames are data URLs from the database */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cameraLabel } from "@/lib/observers";

type LogEntry = {
  id: string;
  ts: number;
  at: string;
  type: string;
  kind: string;
  observerId: string | null;
  text: string;
};

type Episode = {
  id: string;
  ts: number;
  at: string;
  observerId: string;
  trigger: string;
  changes: string[];
  tokens: number;
  frames: string[];
};

type Place = {
  name: string;
  place: string | null;
  catalogued: boolean;
  items: { name: string; count: number }[];
  lastSeen: string;
  lastObserver: string;
  references: { image: string; at: string; observerId: string }[];
  anchor: { name: string; views: number; updatedAt: string } | null;
  log: LogEntry[];
  episodes: Episode[];
};

type Body = {
  places: Place[];
  looseAnchors: { name: string; views: number; updatedAt: string }[];
  error?: string;
};

/** One mark on a place's timeline: a look by a camera (with its frames) or a recorded event. */
type Mark = {
  id: string;
  ts: number;
  at: string;
  kind: "snapshot" | "removed" | "added" | "registered" | "note";
  title: string;
  detail: string;
  observerId: string | null;
  frames: string[];
};

const REFRESH_MS = 6000;
const PLAY_MS = 1400;
const TRACK_PX = 900;
const SNAPSHOT_GAP_PX = 58;
const MARK_GAP_PX = 24;

const markColor: Record<Mark["kind"], string> = {
  snapshot: "bg-white/50",
  removed: "bg-change",
  added: "bg-memory",
  registered: "bg-location",
  note: "bg-voice",
};

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] tracking-[0.18em] text-white/40 uppercase">{children}</p>;
}

function buildMarks(place: Place): Mark[] {
  const episodes: Mark[] = place.episodes.map((episode) => ({
    id: `e-${episode.id}`,
    ts: episode.ts,
    at: episode.at,
    kind: "snapshot",
    title: episode.changes.length ? episode.changes.join(" · ") : "Looked, no change",
    detail: `${cameraLabel(episode.observerId)} · ${episode.trigger}`,
    observerId: episode.observerId,
    frames: episode.frames,
  }));
  const events: Mark[] = place.log
    // A "look" event duplicates the episode mark that carries the frames.
    .filter((entry) => entry.kind !== "look")
    .map((entry) => ({
      id: `l-${entry.id}`,
      ts: entry.ts,
      at: entry.at,
      kind:
        entry.kind === "removed" || entry.kind === "added"
          ? entry.kind
          : entry.type === "observation"
            ? "registered"
            : "note",
      title: entry.text,
      detail: entry.observerId ? cameraLabel(entry.observerId) : "",
      observerId: entry.observerId,
      frames: [],
    }));
  return [...episodes, ...events].sort((a, b) => a.ts - b.ts);
}

function Timeline({ place, onZoom }: { place: Place; onZoom: (image: string) => void }) {
  const marks = useMemo(() => buildMarks(place), [place]);
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const current = marks.find((mark) => mark.id === selected) ?? marks.at(-1);

  // Play: step through the marks in order, like scrubbing the place's history.
  useEffect(() => {
    if (!playing || marks.length === 0) return;
    const index = Math.max(0, marks.findIndex((mark) => mark.id === current?.id));
    const timer = window.setTimeout(() => {
      if (index >= marks.length - 1) setPlaying(false);
      else setSelected(marks[index + 1].id);
    }, PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, marks, current?.id]);

  if (marks.length === 0) return <p className="text-[13px] text-white/40">Nothing recorded yet.</p>;

  const first = marks[0].ts;
  const span = Math.max(1, marks.at(-1)!.ts - first);
  // Marks sit where they fall in time on a track at least TRACK_PX wide, but
  // never so close that two snapshots overlap; a busy stretch widens the
  // track and the timeline scrolls sideways.
  const positions: number[] = [];
  marks.forEach((mark, index) => {
    const natural = 32 + ((mark.ts - first) / span) * (TRACK_PX - 64);
    const previous = positions[index - 1];
    const gap = mark.frames.length > 0 || marks[index - 1]?.frames.length ? SNAPSHOT_GAP_PX : MARK_GAP_PX;
    positions.push(previous === undefined ? natural : Math.max(natural, previous + gap));
  });
  const trackWidth = Math.max(TRACK_PX, positions.at(-1)! + 40);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing) setSelected(marks[0].id);
            setPlaying(!playing);
          }}
          className="rounded border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-white/75 uppercase hover:bg-white/[0.06]"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <p className="font-mono text-[10px] text-white/35">
          {marks.length} marks · {marks.filter((mark) => mark.frames.length > 0).length} with snapshots · {marks[0].at} to{" "}
          {marks.at(-1)!.at}
        </p>
        <p className="ml-auto flex items-center gap-3 font-mono text-[10px] text-white/40">
          {(["snapshot", "removed", "added", "registered", "note"] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${markColor[kind]}`} />
              {kind}
            </span>
          ))}
        </p>
      </div>

      <div className="stream-scroll overflow-x-auto pb-2">
        <div className="relative h-32" style={{ width: `${trackWidth}px`, minWidth: "100%" }}>
          <div key={place.name} className="timeline-line absolute top-[5.75rem] right-0 left-0 h-px bg-white/15" />
          {marks.map((mark, index) => {
            const active = mark.id === current?.id;
            return (
              <button
                key={mark.id}
                type="button"
                title={`${mark.at} · ${mark.title}`}
                onClick={() => {
                  setPlaying(false);
                  setSelected(mark.id);
                }}
                className="timeline-mark absolute top-0 flex h-32 w-14 -translate-x-1/2 flex-col items-center"
                style={{ left: `${positions[index]}px`, animationDelay: `${Math.min(index * 45, 1400)}ms` }}
              >
                {/* The snapshot kept for this moment sits above its mark: the
                    last frame of the look, which shows how things ended up. */}
                {mark.frames.length > 0 ? (
                  <img
                    src={mark.frames.at(-1)}
                    alt=""
                    loading="lazy"
                    className={`h-[4.5rem] w-12 rounded-[3px] border object-cover transition-all ${
                      active ? "border-white/80" : "border-white/15 opacity-70"
                    }`}
                  />
                ) : (
                  <span className="h-[4.5rem] w-12" />
                )}
                <span
                  className={`mt-3 rounded-full transition-all ${markColor[mark.kind]} ${
                    active ? "h-3.5 w-3.5 ring-2 ring-white/70" : "h-2.5 w-2.5"
                  }`}
                />
                <span className={`mt-1.5 font-mono text-[9px] ${active ? "text-white/80" : "text-white/25"}`}>
                  {mark.at.slice(-8, -3)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {current ? (
        <div key={current.id} className="event-enter mt-2 rounded-md border border-white/[0.07] bg-panel px-4 py-3">
          <p className="font-mono text-[11px] text-white/45">
            {current.at}
            {current.detail ? ` · ${current.detail}` : ""}
          </p>
          <p className={`mt-1 text-[14px] ${current.kind === "removed" ? "text-change" : current.kind === "added" ? "text-memory" : "text-white/85"}`}>
            {current.title}
          </p>
          {current.frames.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {current.frames.map((frame, index) => (
                <li key={index}>
                  <button type="button" onClick={() => onZoom(frame)}>
                    <img src={frame} alt={`Snapshot ${index + 1}`} className="h-28 rounded border border-white/10 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : current.kind === "snapshot" ? (
            <p className="mt-2 font-mono text-[10px] text-white/30">snapshots expired (kept 24 hours)</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tracked places as folders: pick one on the left to see its timeline of
 * snapshots and changes, the full log for that place, the reference photos
 * used to recognise it, and to delete it.
 */
export function Places() {
  const [body, setBody] = useState<Body | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = (await (await fetch("/api/places", { cache: "no-store" })).json()) as Body;
        if (!cancelled) setBody(next);
      } catch {
        // Keep showing what we have; the next refresh retries.
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reload]);

  const places = body?.places ?? [];
  const current = places.find((place) => place.name === selected) ?? places[0];

  const remove = async (name: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/places?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string; removed?: Record<string, number> };
      if (!response.ok || result.error) throw new Error(result.error ?? `delete ${response.status}`);
      setNotice(`Deleted “${name}”: ${result.removed?.events ?? 0} events, ${result.removed?.episodes ?? 0} episodes.`);
      setSelected(null);
      setReload((value) => value + 1);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink text-foreground">
      <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-white/[0.08] px-5 sm:px-7">
        <div>
          <h1 className="text-[15px] font-medium tracking-[0.22em] text-white">OPENSTATE</h1>
          <p className="mt-1 text-[12px] text-white/45">Tracked places · timeline and logs</p>
        </div>
        <Link href="/" className="text-[11px] tracking-[0.16em] text-white/60 hover:text-white">
          ← DASHBOARD
        </Link>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
        <nav aria-label="Places" className="stream-scroll overflow-y-auto border-r border-white/[0.06] px-3 py-4">
          <Label>Places · {places.length}</Label>
          {!body ? (
            <p className="flex items-center gap-2 px-2 text-[13px] text-white/40">
              <span className="spinner" aria-hidden /> Loading
            </p>
          ) : null}
          {body && places.length === 0 ? (
            <p className="px-2 text-[13px] leading-5 text-white/40">
              Nothing tracked yet. Point a phone at a place and say “Hey World, remember this place”.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {places.map((place) => (
              <li key={place.name}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(place.name);
                    setConfirming(null);
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left ${
                    current?.name === place.name ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="block text-[14px] text-white/90">{place.name}</span>
                  <span className="block font-mono text-[10px] text-white/35">
                    {place.log.length} log lines · {place.references.length} photos ·{" "}
                    {place.anchor ? `${place.anchor.views} views` : "no anchor"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {body?.looseAnchors.length ? (
            <div className="mt-6">
              <Label>Anchors without a site</Label>
              <ul className="flex flex-col gap-1 px-3">
                {body.looseAnchors.map((anchor) => (
                  <li key={anchor.name} className="text-[12px] text-white/60">
                    {anchor.name}
                    <span className="font-mono text-[10px] text-white/35"> · {anchor.views} views</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>

        <section className="stream-scroll min-h-0 overflow-y-auto px-7 py-6">
          {notice ? (
            <p className="mb-4 rounded border border-white/10 bg-panel px-3 py-2 text-[12px] text-white/70">{notice}</p>
          ) : null}
          {body?.error ? <p className="text-[13px] text-live">{body.error}</p> : null}
          {current ? (
            <div className="flex flex-col gap-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[20px] text-white">
                    {current.name}
                    {current.place ? <span className="text-white/40"> · {current.place}</span> : null}
                  </h2>
                  <p className="mt-1 font-mono text-[11px] text-white/40">
                    last checked {current.lastSeen} by {cameraLabel(current.lastObserver)}
                  </p>
                </div>
                {confirming === current.name ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-white/60">Delete this place and its history?</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => remove(current.name)}
                      className="flex items-center gap-1.5 rounded bg-live/20 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-live uppercase hover:bg-live/30 disabled:opacity-60"
                    >
                      {deleting ? <span className="spinner" aria-hidden /> : null}
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-white/60 uppercase"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(current.name)}
                    className="rounded border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-white/55 uppercase hover:border-live/50 hover:text-live"
                  >
                    Delete place
                  </button>
                )}
              </div>

              <div>
                <Label>Timeline · each picture is the snapshot kept for that moment</Label>
                <Timeline key={current.name} place={current} onZoom={setZoom} />
              </div>

              <div>
                <Label>Contents now</Label>
                {!current.catalogued ? (
                  <p className="text-[13px] text-white/40">Not seen yet</p>
                ) : current.items.length === 0 ? (
                  <p className="text-[13px] text-white/40">Empty</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {current.items.map((item) => (
                      <li key={item.name} className="rounded border border-white/[0.08] px-2 py-0.5 text-[12px] text-white/75">
                        {item.name}
                        {item.count > 1 ? <span className="ml-1 font-mono text-memory">×{item.count}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <Label>Log for this place · {current.log.length} lines, newest first</Label>
                {current.log.length === 0 ? (
                  <p className="text-[13px] text-white/40">Nothing logged yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {[...current.log].reverse().map((entry) => (
                      <li key={entry.id} className="grid grid-cols-[7.5rem_5rem_minmax(0,1fr)] gap-x-2 text-[12px] leading-5">
                        <span className="font-mono text-[11px] text-white/35">{entry.at}</span>
                        <span
                          className={`font-mono text-[10px] tracking-wide uppercase ${
                            entry.kind === "removed" ? "text-change" : entry.kind === "added" ? "text-memory" : "text-white/35"
                          }`}
                        >
                          {entry.kind}
                        </span>
                        <span className="text-white/70">
                          {entry.text}
                          {entry.observerId ? <span className="text-white/30"> · {cameraLabel(entry.observerId)}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <Label>Reference photos · used to tell this place from others</Label>
                {current.references.length === 0 ? (
                  <p className="text-[13px] text-white/40">No reference photo stored.</p>
                ) : (
                  <ul className="flex flex-wrap gap-3">
                    {current.references.map((reference, index) => (
                      <li key={index}>
                        <button type="button" onClick={() => setZoom(reference.image)}>
                          <img
                            src={reference.image}
                            alt={`Reference ${index + 1} of ${current.name}`}
                            className="h-40 rounded-md border border-white/10 object-cover"
                          />
                        </button>
                        <p className="mt-1 font-mono text-[10px] text-white/35">
                          {reference.at} · {cameraLabel(reference.observerId)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <Label>Visual anchor · embeddings that start capture when the view matches</Label>
                <p className="text-[13px] text-white/65">
                  {current.anchor
                    ? `${current.anchor.views} embedded views, updated ${current.anchor.updatedAt}`
                    : "None saved. Say “Hey World, remember this place” while looking at it."}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </main>

      {zoom ? (
        <button
          type="button"
          aria-label="Close picture"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
        >
          <img src={zoom} alt="Enlarged frame" className="max-h-full max-w-full rounded-md" />
        </button>
      ) : null}
    </div>
  );
}

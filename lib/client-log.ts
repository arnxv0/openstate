"use client";

// Browser half of the debugging trail (see lib/log.ts): the dashboard and the
// phones queue short events here and they are posted to /api/log in batches,
// so what a phone was doing can be read on the laptop afterwards.

type Entry = { t: string; src: "dashboard" | "phone"; scope: string; msg: string; data?: Record<string, unknown> };

const FLUSH_MS = 2000;
const MAX_QUEUE = 200;

let queue: Entry[] = [];
let timer = 0;
let hooked = false;

function source(): Entry["src"] {
  return window.location.pathname.startsWith("/observe") ? "phone" : "dashboard";
}

function flush() {
  timer = 0;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify({ entries: batch }),
    keepalive: true,
  }).catch(() => {
    // Logging must never surface as an app error; the batch is dropped.
  });
}

function hookGlobalErrors() {
  if (hooked) return;
  hooked = true;
  window.addEventListener("error", (event) =>
    clog("window", "error", { message: event.message, at: `${event.filename}:${event.lineno}` }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    clog("window", "unhandled rejection", { reason: String(event.reason).slice(0, 300) }),
  );
  window.addEventListener("pagehide", flush);
}

/** Queue one event for the shared log. Safe to call from anywhere on the client. */
export function clog(scope: string, msg: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  hookGlobalErrors();
  if (queue.length >= MAX_QUEUE) queue.shift();
  const src = source();
  // Phones are told apart by their page (/observe/01, /observe/02).
  const tagged = src === "phone" ? { page: window.location.pathname, ...data } : data;
  queue.push({ t: new Date().toISOString(), src, scope, msg, data: tagged });
  if (!timer) timer = window.setTimeout(flush, FLUSH_MS);
}

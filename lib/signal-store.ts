import type { ObserverId } from "@/lib/types";

const PHONE_STALE_MS = 6000;
const VIEWER_STALE_MS = 30000;

export type ViewerOffer = {
  viewer: string;
  offerId: string;
  phoneSession: string;
  offer: string;
  answer?: string;
  at: number;
};

type ObserverSlot = {
  phone?: { session: string; seenAt: number };
  viewers: Map<string, ViewerOffer>;
};

export type PhonePoll = { offers: ViewerOffer[]; busy?: boolean };

export type ViewerPoll = {
  phoneSession: string | null;
  offerId?: string;
  answer?: string;
};

const globalStore = globalThis as typeof globalThis & {
  __openstateViewerSignals?: Map<ObserverId, ObserverSlot>;
};

const store =
  globalStore.__openstateViewerSignals ??
  (globalStore.__openstateViewerSignals = new Map());

export function isObserverId(value: string): value is ObserverId {
  return value === "01" || value === "02";
}

function slotFor(id: ObserverId) {
  let slot = store.get(id);
  if (!slot) {
    slot = { viewers: new Map() };
    store.set(id, slot);
  }
  const now = Date.now();
  for (const [viewer, entry] of slot.viewers) {
    if (now - entry.at > VIEWER_STALE_MS) slot.viewers.delete(viewer);
  }
  return slot;
}

export function phonePoll(id: ObserverId, session: string): PhonePoll {
  const slot = slotFor(id);
  if (slot.phone && slot.phone.session !== session) {
    if (Date.now() - slot.phone.seenAt <= PHONE_STALE_MS) {
      return { offers: [], busy: true };
    }
    slot.viewers.clear();
  }
  slot.phone = { session, seenAt: Date.now() };
  return {
    offers: [...slot.viewers.values()].filter(
      (entry) => entry.phoneSession === session && !entry.answer,
    ),
  };
}

export function phoneAnswer(
  id: ObserverId,
  session: string,
  viewer: string,
  offerId: string,
  sdp: string,
) {
  const entry = slotFor(id).viewers.get(viewer);
  if (!entry || entry.phoneSession !== session || entry.offerId !== offerId) {
    return false;
  }
  entry.answer = sdp;
  entry.at = Date.now();
  return true;
}

export function phoneLeave(id: ObserverId, session: string) {
  const slot = slotFor(id);
  if (slot.phone?.session === session) {
    slot.phone = undefined;
    slot.viewers.clear();
  }
}

export function viewerPoll(id: ObserverId, viewer: string): ViewerPoll {
  const slot = slotFor(id);
  const phone = slot.phone;
  if (!phone || Date.now() - phone.seenAt > PHONE_STALE_MS) {
    return { phoneSession: null };
  }
  const entry = slot.viewers.get(viewer);
  if (entry) entry.at = Date.now();
  return {
    phoneSession: phone.session,
    offerId: entry?.phoneSession === phone.session ? entry.offerId : undefined,
    answer: entry?.phoneSession === phone.session ? entry.answer : undefined,
  };
}

export function viewerOffer(
  id: ObserverId,
  entry: Omit<ViewerOffer, "answer" | "at">,
) {
  const slot = slotFor(id);
  if (slot.phone?.session !== entry.phoneSession) return false;
  slot.viewers.set(entry.viewer, { ...entry, at: Date.now() });
  return true;
}

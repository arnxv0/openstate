import type { Observer } from "@/lib/types";

const INITIAL_OBSERVERS: Observer[] = [
  {
    id: "01",
    name: "Thilak",
    status: "online",
    phase: "localizing",
    breadcrumb: [],
    speech: { status: "idle" },
    videoUrl: "/videos/observer-01.mp4",
  },
  {
    id: "02",
    name: "Arnav",
    status: "online",
    phase: "localizing",
    breadcrumb: [],
    speech: { status: "idle" },
    videoUrl: "/videos/observer-02.mp4",
  },
];

/** "Thilak" for "01"; the bare id when no name is set or the id is unknown. */
export function observerName(id: string | null | undefined) {
  return INITIAL_OBSERVERS.find((observer) => observer.id === id)?.name ?? `observer ${id ?? "?"}`;
}

/** "Thilak's camera": whose phone saw something. */
export function cameraLabel(id: string | null | undefined) {
  const name = INITIAL_OBSERVERS.find((observer) => observer.id === id)?.name;
  return name ? `${name}'s camera` : `observer ${id ?? "?"}`;
}

/** One line telling the answer model who each observer id is. */
export const OBSERVER_KEY = INITIAL_OBSERVERS.filter((observer) => observer.name)
  .map((observer) => `observer ${observer.id} = ${observer.name}'s camera`)
  .join("; ");

export function cloneObservers(): Observer[] {
  return INITIAL_OBSERVERS.map((observer) => ({
    ...observer,
    breadcrumb: [...observer.breadcrumb],
    speech: { status: "idle" },
  }));
}

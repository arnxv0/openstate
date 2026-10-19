import { CameraFeed } from "@/components/openstate/CameraFeed";
import type { LiveVoices } from "@/lib/use-live-world";
import type { Observer, ObserverId } from "@/lib/types";

export function ObserverPanel({
  observers,
  streams,
  voices,
  capture,
  clock,
}: {
  observers: Observer[];
  streams: Partial<Record<ObserverId, MediaStream>>;
  voices: LiveVoices;
  capture?: { leader: boolean; viewer: string };
  clock: string;
}) {
  return (
    <section
      aria-label="Observer feeds"
      className="flex h-full min-h-0 flex-col gap-2.5"
    >
      {observers.map((observer) => (
        <CameraFeed
          key={observer.id}
          observer={observer}
          stream={streams[observer.id]}
          voice={voices[observer.id]}
          capture={capture}
          clock={clock}
        />
      ))}
    </section>
  );
}

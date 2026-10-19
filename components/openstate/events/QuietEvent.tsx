import { EventFrame } from "@/components/openstate/events/EventFrame";
import { SpatialBreadcrumb } from "@/components/openstate/SpatialBreadcrumb";
import type { WorldEvent } from "@/lib/types";

export function QuietEvent({
  event,
  opacity,
}: {
  event: WorldEvent;
  opacity: number;
}) {
  return (
    <EventFrame event={event} opacity={opacity}>
      {event.type === "location" && event.location ? (
        <div>
          <p className="text-[13px] leading-5 text-white/70">
            Observer {event.observerId} entered
          </p>
          <div className="mt-1.5">
            <SpatialBreadcrumb segments={event.location} />
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13px] leading-5 text-white/70">{event.title}</p>
          {event.message && (
            <p className="mt-0.5 text-[12px] leading-5 text-white/40">
              {event.message}
            </p>
          )}
        </div>
      )}
    </EventFrame>
  );
}

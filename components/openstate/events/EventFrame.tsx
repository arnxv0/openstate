import type { ReactNode } from "react";
import type { WorldEvent } from "@/lib/types";

export function EventFrame({
  event,
  opacity,
  children,
}: {
  event: WorldEvent;
  opacity: number;
  children: ReactNode;
}) {
  return (
    <li className="transition-opacity duration-700" style={{ opacity }}>
      <div className="event-enter grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] gap-x-3">
        <time className="pt-0.5 font-mono text-[11px] text-white/35 tabular-nums">
          {event.timestamp}
        </time>
        <span className="pt-0.5 font-mono text-[10px] tracking-wide text-white/40">
          {event.observerId}
        </span>
        <div className="min-w-0">{children}</div>
      </div>
    </li>
  );
}

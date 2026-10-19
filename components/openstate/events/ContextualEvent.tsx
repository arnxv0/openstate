import { EventFrame } from "@/components/openstate/events/EventFrame";
import { SpatialBreadcrumb } from "@/components/openstate/SpatialBreadcrumb";
import { formatMatch } from "@/lib/time";
import type { EventType, WorldEvent } from "@/lib/types";

const shell: Partial<Record<EventType, string>> = {
  context: "border-l border-location/35 pl-4",
  voice: "border-l border-voice/40 pl-5",
  memory: "border-l border-memory/45 pl-4",
  observation: "border-l border-white/15 pl-4",
  privacy: "privacy-card border-l border-white/10 pl-4",
  answer: "border-l border-white/45 pl-5",
  agent: "border-l border-dashed border-white/20 pl-4",
};

const labelTone: Partial<Record<EventType, string>> = {
  context: "text-location",
  voice: "text-voice",
  memory: "text-memory",
  observation: "text-white/50",
  privacy: "text-white/35",
  answer: "text-white/70",
  agent: "text-white/40",
};

export function ContextualEvent({
  event,
  opacity,
}: {
  event: WorldEvent;
  opacity: number;
}) {
  return (
    <EventFrame event={event} opacity={opacity}>
      <div className={`py-1 ${shell[event.type] ?? "border-l border-white/15 pl-4"}`}>
        <p
          className={`text-[10px] tracking-[0.18em] uppercase ${labelTone[event.type] ?? "text-white/50"}`}
        >
          {event.title}
        </p>

        {event.type === "voice" && event.message ? (
          <blockquote className="mt-2 text-[15px] leading-6 text-white/90">
            “{event.message}”
          </blockquote>
        ) : null}

        {event.type === "context" && event.message ? (
          <p className="mt-2 text-[15px] leading-6 text-white/90">{event.message}</p>
        ) : null}

        {event.type === "agent" && event.message ? (
          <p className="mt-1.5 text-[13px] leading-5 text-white/65">
            {event.message}
            {event.metadata?.detail ? (
              <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-white/30">· {event.metadata.detail}</span>
            ) : null}
          </p>
        ) : null}

        {event.type === "memory" && event.location ? (
          <div className="mt-2">
            <SpatialBreadcrumb segments={event.location} />
          </div>
        ) : null}

        {event.type === "memory" && event.message ? (
          <p
            className={
              event.location
                ? "mt-2 text-[12px] leading-5 text-white/45"
                : "mt-2 text-[15px] leading-6 text-white/90"
            }
          >
            {event.message}
          </p>
        ) : null}

        {event.type === "answer" && event.metadata?.question ? (
          <p className="mt-2 text-[12px] leading-5 text-white/40">
            {event.metadata.question}
          </p>
        ) : null}

        {event.type === "answer" && event.message ? (
          <p className="mt-1.5 text-[17px] leading-7 text-white">{event.message}</p>
        ) : null}

        {event.type === "answer" && event.metadata?.latencyMs !== undefined ? (
          <p className="mt-2 font-mono text-[10px] tracking-[0.14em] text-white/30">
            ANSWERED IN {(event.metadata.latencyMs / 1000).toFixed(1)}S
          </p>
        ) : null}

        {event.type === "context" && event.location ? (
          <div className="mt-2">
            <SpatialBreadcrumb segments={event.location} />
          </div>
        ) : null}

        {event.type === "observation" && event.metadata?.items ? (
          <ul className="mt-2 space-y-1">
            {event.metadata.items.map((item) => (
              <li key={item} className="text-[15px] leading-6 text-white/90">
                {item}
              </li>
            ))}
          </ul>
        ) : null}

        {event.type === "observation" && event.message ? (
          <p className="mt-2 text-[12px] leading-5 text-white/45">{event.message}</p>
        ) : null}

        {event.type === "privacy" && event.message ? (
          <p className="mt-2 text-[15px] leading-6 text-white/55">{event.message}</p>
        ) : null}

        {event.type === "privacy" && event.metadata?.detail ? (
          <p className="mt-1 text-[12px] leading-5 text-white/35">
            {event.metadata.detail}
          </p>
        ) : null}

        {event.type === "context" && event.confidence !== undefined ? (
          <p className="mt-2 font-mono text-[10px] tracking-[0.14em] text-white/35">
            VISUAL MATCH · {formatMatch(event.confidence)}
          </p>
        ) : null}
      </div>
    </EventFrame>
  );
}

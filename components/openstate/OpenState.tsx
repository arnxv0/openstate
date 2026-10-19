"use client";

import { useSyncExternalStore } from "react";
import { CompanyPanel } from "@/components/openstate/CompanyPanel";
import { ContextStream } from "@/components/openstate/ContextStream";
import { Header } from "@/components/openstate/Header";
import { MemoryPanel } from "@/components/openstate/MemoryPanel";
import { ObserverPanel } from "@/components/openstate/ObserverPanel";
import { useCaptureLease } from "@/lib/use-capture-lease";
import { useLiveWorld } from "@/lib/use-live-world";
import { usePhoneStreams } from "@/lib/use-phone-streams";
import { useWorldState } from "@/lib/use-world-state";

const noopSubscribe = () => () => {};

function useDemoMode() {
  return useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("demo") === "1",
    () => false,
  );
}

export function OpenState() {
  const demoMode = useDemoMode();
  const demo = useWorldState(demoMode);
  const live = useLiveWorld(!demoMode);
  const { events, observers, clock, latency, fading } = demoMode ? demo : live;
  const voices = demoMode ? {} : live.voices;
  const capture = useCaptureLease(!demoMode);
  const streams = usePhoneStreams();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink text-foreground">
      <Header
        clock={clock}
        latency={latency}
        latencyLabel={demoMode ? "LATENCY" : "ATLAS"}
      />
      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(240px,42vh)_minmax(0,1fr)] gap-2.5 px-3 pt-3 pb-3 min-[1100px]:grid-rows-1 min-[1100px]:grid-cols-[minmax(0,64fr)_minmax(0,36fr)]">
        <div
          className={`order-2 h-full min-h-0 min-[1100px]:order-1 ${
            demoMode ? "" : "grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]"
          }`}
        >
          <ContextStream
            events={events}
            fading={fading}
            voices={voices}
            emptyHint={
              demoMode
                ? "Waiting for spatial observations..."
                : "Say \u201cHey World\u201d on an observer phone to ask or remember something."
            }
          />
          {demoMode ? null : (
            <div className="hidden min-h-0 min-[1100px]:grid min-[1100px]:grid-rows-2 min-[1100px]:gap-2.5">
              <CompanyPanel />
              <div className="min-h-0">
                <MemoryPanel revision={events.at(-1)?.id ?? ""} />
              </div>
            </div>
          )}
        </div>
        <div className="order-1 h-full min-h-0 min-[1100px]:order-2">
          <ObserverPanel
            observers={observers}
            streams={streams}
            voices={voices}
            capture={demoMode ? undefined : capture}
            clock={clock}
          />
        </div>
      </main>
    </div>
  );
}

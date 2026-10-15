import { useEffect, useState, useSyncExternalStore } from "react";
import { sim, type SimStats } from "@/lib/sim";
import { useTraffic } from "@/lib/traffic";

export type ViewPick = "auto" | "live" | "sim";
let pick: ViewPick = "auto";
const listeners = new Set<() => void>();
export function setViewPick(next: ViewPick) {
  pick = next;
  listeners.forEach((fn) => fn());
}
function useViewPick(): ViewPick {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => pick,
    () => "auto",
  );
}

/**
 * Which traffic the 3D scenes show.
 * - "live": tracked detections from the Python engine only.
 * - "sim": the built-in synthetic traffic simulation (clearly labelled as such in the UI).
 * "auto" shows live detections while the engine is analysing, and the simulation otherwise.
 */
export function useViewMode() {
  const choice = useViewPick();
  const { state, connected } = useTraffic();
  const analysing = connected && (state.status === "ANALYZING" || state.status === "PAUSED");
  const mode: "live" | "sim" = choice === "auto" ? (analysing ? "live" : "sim") : choice;
  return { mode, choice, setChoice: setViewPick };
}

/** Polls the simulation for display numbers; the 3D scene reads the engine directly. */
export function useSimStats(intervalMs = 300): SimStats {
  const [stats, setStats] = useState<SimStats>(() => sim.snapshot());
  useEffect(() => {
    const timer = window.setInterval(() => setStats(sim.snapshot()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return stats;
}

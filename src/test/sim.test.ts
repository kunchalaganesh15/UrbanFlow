import { describe, expect, it } from "vitest";
import { STOP_Z, SPAWN, TrafficSim, toWorld } from "@/lib/sim";

const run = (sim: TrafficSim, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * 30; i++) {
    sim.step(1 / 30);
    each?.();
  }
};

describe("traffic simulation", () => {
  it("maps canonical approach coordinates onto the four roads", () => {
    expect(toWorld(0, 2.25, -10).z).toBeCloseTo(-10); // North: z < 0
    expect(toWorld(1, 2.25, -10).x).toBeCloseTo(10); // East: x > 0
    expect(toWorld(2, 2.25, -10).z).toBeCloseTo(10); // South: z > 0
    expect(toWorld(3, 2.25, -10).x).toBeCloseTo(-10); // West: x < 0
  });

  it("gives green to one approach at a time and always separates changes", () => {
    const sim = new TrafficSim(7);
    const seen: string[] = [];
    run(sim, 240, () => {
      const tag = `${sim.signal.phase}:${sim.signal.road}`;
      if (seen.at(-1) !== tag) seen.push(tag);
    });
    for (let i = 0; i < seen.length; i++) {
      if (seen[i].startsWith("GREEN")) {
        const next = seen[i + 1];
        if (next) expect(next.startsWith("YELLOW")).toBe(true);
      }
      if (seen[i].startsWith("YELLOW")) expect(seen[i + 1] ?? "ALL_RED:null").toMatch(/^ALL_RED/);
    }
    expect(seen.filter((s) => s.startsWith("GREEN")).length).toBeGreaterThan(5);
  });

  it("keeps vehicles from overlapping and keeps traffic flowing", () => {
    const sim = new TrafficSim(11);
    let overlaps = 0;
    run(sim, 240, () => {
      const v = sim.vehicles;
      for (let i = 0; i < v.length; i++)
        for (let j = i + 1; j < v.length; j++)
          if (Math.cos(v[i].heading - v[j].heading) > 0.5 && Math.hypot(v[i].x - v[j].x, v[i].z - v[j].z) < ((v[i].len + v[j].len) / 2) * 0.8) overlaps++;
    });
    expect(overlaps).toBe(0);
    expect(sim.completed).toBeGreaterThan(80);
  });

  it("does not cross the stop line on red", () => {
    const sim = new TrafficSim(3);
    const prev = new Map<number, number>();
    let runners = 0;
    run(sim, 240, () => {
      for (const v of sim.vehicles) {
        const front = v.s + v.len / 2;
        const was = prev.get(v.id);
        const line = SPAWN + STOP_Z;
        if (was !== undefined && was < line && front >= line) {
          const sig = sim.signal;
          const onOwnGreenOrYellow = sig.road === v.approach && (sig.phase === "GREEN" || sig.phase === "YELLOW");
          // A car already committed on yellow may finish crossing just as all-red begins.
          const clearingYellow = sig.phase === "ALL_RED" && sig.elapsed < 0.5 && v.speed > 3;
          const allowed = onOwnGreenOrYellow || clearingYellow;
          if (!allowed) runners++;
        }
        prev.set(v.id, front);
      }
    });
    expect(runners).toBe(0);
  });

  it("stays collision-free at the fastest playback speed", () => {
    const sim = new TrafficSim(19);
    sim.settings.speed = 2.5;
    sim.settings.density = 0.5;
    let overlaps = 0;
    run(sim, 180, () => {
      const v = sim.vehicles;
      for (let i = 0; i < v.length; i++)
        for (let j = i + 1; j < v.length; j++)
          if (Math.cos(v[i].heading - v[j].heading) > 0.5 && Math.hypot(v[i].x - v[j].x, v[i].z - v[j].z) < ((v[i].len + v[j].len) / 2) * 0.8) overlaps++;
    });
    expect(overlaps).toBe(0);
  });

  it("preempts the signal for an ambulance and keeps the other mode alive", () => {
    const sim = new TrafficSim(5);
    sim.settings.autoEmergency = false;
    sim.settings.density = 0.1;
    run(sim, 20);
    const target = [0, 1, 2, 3].find((i) => sim.signal.road !== i) as number;
    sim.dispatchAmbulance(target);
    let greenedForAmbulance = false;
    run(sim, 40, () => {
      const a = sim.vehicles.find((v) => v.emergency);
      if (a && sim.signal.road === target && sim.signal.phase === "GREEN") greenedForAmbulance = true;
    });
    expect(greenedForAmbulance).toBe(true);
    sim.settings.adaptive = false;
    run(sim, 60);
    expect(sim.completed).toBeGreaterThan(0);
  });

  it("sends emergency vehicles on its own and records an event for each", () => {
    const sim = new TrafficSim(9);
    run(sim, 90);
    expect(sim.events.length).toBeGreaterThan(0);
    expect(sim.events.every((e) => e.kind === "ambulance" || e.kind === "fire truck")).toBe(true);
    const off = new TrafficSim(9);
    off.settings.autoEmergency = false;
    run(off, 90);
    expect(off.events.length).toBe(0);
  });
});

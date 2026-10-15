/**
 * UrbanFlow traffic simulation engine.
 *
 * Pure TypeScript, no React or three.js, so it can be unit-tested and stepped from the
 * 3D render loop. Everything is described in a canonical frame for the NORTH approach
 * (vehicles travel toward +Z, the junction box is |X|,|Z| <= 4.5) and rotated into the
 * world for the other three approaches with `toWorld`.
 *
 * Traffic drives on the LEFT: inbound lanes sit at +X in the canonical frame. For
 * right-hand traffic, mirror X in `buildPath` and the signal masts in Junction.tsx.
 *
 * This is a visualization model. It never talks to signal hardware.
 */
export const APPROACH_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;
export const HALF_ROAD = 4.5;
export const SPAWN = 56; // distance from centre where vehicles enter / leave
export const STOP_Z = -5.8; // canonical stop line (vehicle front bumper)
export const LANE_X = 2.25; // canonical inbound lane centre

export type Turn = "S" | "L" | "R";
export type Kind = "car" | "truck" | "bus" | "motorcycle" | "ambulance" | "fire truck";
export type Phase = "GREEN" | "YELLOW" | "ALL_RED";

export interface SimVehicle {
  id: number;
  kind: Kind;
  color: string;
  approach: number;
  turn: Turn;
  s: number; // arclength of vehicle centre along its path
  speed: number;
  vmax: number;
  len: number;
  x: number;
  z: number;
  heading: number;
  waited: number;
  emergency: boolean;
}
export interface SimSignal {
  road: number | null;
  phase: Phase;
  elapsed: number;
  remaining: number;
  next: number | null;
}
export interface SimSettings {
  density: number; // vehicles per second per approach (average)
  speed: number; // time / speed multiplier
  adaptive: boolean;
  autoEmergency: boolean; // spawn ambulances / fire trucks automatically
}
export interface SimEvent {
  id: number;
  kind: Kind;
  approach: number;
  time: number;
}
export interface SimStats {
  count: number;
  completed: number;
  avgWait: number;
  queue: number[];
  signal: { road: number | null; phase: Phase; remaining: number };
  adaptive: boolean;
  time: number;
  ambulances: number;
}

/** Rotate a canonical (North-approach) point/heading into the world frame. */
export function toWorld(approach: number, X: number, Z: number, psi = 0) {
  const a = APPROACH_ANGLE[approach];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: X * c + Z * s, z: -X * s + Z * c, heading: psi + a };
}

/* ---------------------------------- paths ---------------------------------- */
interface Seg {
  len: number;
  at: (u: number) => [number, number, number];
}
function line(x0: number, z0: number, x1: number, z1: number): Seg {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const psi = Math.atan2(x1 - x0, z1 - z0);
  return { len, at: (u) => [x0 + ((x1 - x0) * u) / len, z0 + ((z1 - z0) * u) / len, psi] };
}
function arc(cx: number, cz: number, r: number, th0: number, th1: number): Seg {
  const dir = Math.sign(th1 - th0);
  return {
    len: Math.abs(th1 - th0) * r,
    at: (u) => {
      const th = th0 + (dir * u) / r;
      return [
        cx + r * Math.cos(th),
        cz + r * Math.sin(th),
        Math.atan2(-Math.sin(th) * dir, Math.cos(th) * dir),
      ];
    },
  };
}
interface Path {
  segs: Seg[];
  total: number;
}
function buildPath(turn: Turn): Path {
  const first = line(LANE_X, -SPAWN, LANE_X, -HALF_ROAD);
  const segs =
    turn === "S"
      ? [first, line(LANE_X, -HALF_ROAD, LANE_X, SPAWN)]
      : turn === "L"
        ? [first, arc(HALF_ROAD, -HALF_ROAD, 2.25, Math.PI, Math.PI / 2), line(HALF_ROAD, -2.25, SPAWN, -2.25)]
        : [first, arc(-HALF_ROAD, -HALF_ROAD, 6.75, 0, Math.PI / 2), line(-HALF_ROAD, 2.25, -SPAWN, 2.25)];
  return { segs, total: segs.reduce((n, s) => n + s.len, 0) };
}
const PATHS: Record<Turn, Path> = { S: buildPath("S"), L: buildPath("L"), R: buildPath("R") };
export function sampleCanonical(turn: Turn, s: number): [number, number, number] {
  const path = PATHS[turn];
  let rest = Math.max(0, Math.min(path.total, s));
  for (const seg of path.segs) {
    if (rest <= seg.len) return seg.at(rest);
    rest -= seg.len;
  }
  const last = path.segs[path.segs.length - 1];
  return last.at(last.len);
}
export const pathLength = (turn: Turn) => PATHS[turn].total;

/* -------------------------------- parameters -------------------------------- */
const MIN_GREEN = 7;
const MAX_GREEN = 20;
const FIXED_GREEN = 9;
const YELLOW = 2;
const ALL_RED = 1.2;
const ACCEL = 3.4;
const DECEL = 7;
const LEADER_GAP = 1.2;
const STOP_S = SPAWN + STOP_Z; // path arclength of the stop line
export const CAR_COLORS = ["#ff9aa2", "#ffb7b2", "#ffd3a8", "#cdebb4", "#a8e6cf", "#b8c4f5", "#9cc5ff", "#c3b5ff", "#ffe29a", "#9be7f4", "#f6b7e0"];
const SPECS: Record<Kind, { len: number; v: number }> = {
  car: { len: 1.9, v: 8.4 },
  motorcycle: { len: 1.05, v: 9.4 },
  bus: { len: 3.5, v: 6.6 },
  truck: { len: 3.1, v: 7 },
  ambulance: { len: 2.3, v: 10.5 },
  "fire truck": { len: 3.1, v: 9.6 },
};

export class TrafficSim {
  vehicles: SimVehicle[] = [];
  version = 0; // bumps when a vehicle is added or removed
  time = 0;
  settings: SimSettings = { density: 0.2, speed: 1, adaptive: true, autoEmergency: true };
  events: SimEvent[] = [];
  private nextEmergency = 7; // first one appears a few seconds after the scene starts
  private emergencyCount = 0;
  signal: SimSignal = { road: null, phase: "ALL_RED", elapsed: 0, remaining: ALL_RED, next: null };
  queue = [0, 0, 0, 0];
  completed = 0;
  private waits: number[] = [];
  private nextId = 1;
  private acc = [0.6, 0.3, 0.9, 0.1];
  private lastGreen = [0, -4, -8, -12];
  private lastRoad = -1; // most recent road to receive green (for fixed-time rotation)
  private rand: () => number;

  constructor(seed = 20260506) {
    this.rand = mulberry32(seed);
  }

  reset() {
    const { settings } = this;
    Object.assign(this, new TrafficSim());
    this.settings = settings;
    this.version++;
  }

  dispatchAmbulance(approach: number, kind: Kind = "ambulance") {
    if (this.vehicles.some((v) => v.emergency && v.approach === approach)) return;
    this.spawn(approach, kind, true);
  }
  /** Sends an emergency vehicle on a random approach that has none yet. */
  private autoEmergency() {
    const free = [0, 1, 2, 3].filter((a) => !this.vehicles.some((v) => v.emergency && v.approach === a));
    if (!free.length) return;
    const approach = free[Math.floor(this.rand() * free.length)];
    this.dispatchAmbulance(approach, this.emergencyCount++ % 3 === 2 ? "fire truck" : "ambulance");
  }

  step(rawDt: number) {
    // Scale by the speed setting, then integrate in small fixed sub-steps so fast playback
    // stays as stable as normal playback.
    const total = Math.min(rawDt, 0.1) * this.settings.speed;
    const n = Math.ceil(total / 0.05);
    for (let i = 0; i < n; i++) this.tick(total / n);
  }
  private tick(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    this.spawnTraffic(dt);
    if (this.settings.autoEmergency && this.time >= this.nextEmergency) {
      this.autoEmergency();
      this.nextEmergency = this.time + 22 + this.rand() * 18;
    }
    this.updateQueues();
    this.updateSignal(dt);
    this.moveVehicles(dt);
  }

  snapshot(): SimStats {
    const sig = this.signal;
    return {
      count: this.vehicles.length,
      completed: this.completed,
      avgWait: this.waits.length ? this.waits.reduce((a, b) => a + b, 0) / this.waits.length : 0,
      queue: [...this.queue],
      signal: { road: sig.road, phase: sig.phase, remaining: Math.max(0, Math.ceil(sig.remaining)) },
      adaptive: this.settings.adaptive,
      time: this.time,
      ambulances: this.vehicles.filter((v) => v.emergency).length,
    };
  }

  /* ------------------------------- spawning ------------------------------- */
  private spawnTraffic(dt: number) {
    for (let i = 0; i < 4; i++) {
      // Demand rises and falls differently on each approach so adaptive timing has work to do.
      const weight = 0.75 + 0.25 * Math.sin(this.time * 0.05 + i * 1.6);
      this.acc[i] = Math.min(2, this.acc[i] + dt * this.settings.density * weight);
      if (this.acc[i] >= 1) {
        const blocked = this.vehicles.some((v) => v.approach === i && v.s < 9);
        if (!blocked) {
          this.acc[i] -= 1;
          this.spawn(i, this.pickKind(), false);
        }
      }
    }
  }
  private pickKind(): Kind {
    const r = this.rand();
    return r < 0.64 ? "car" : r < 0.78 ? "motorcycle" : r < 0.87 ? "bus" : "truck";
  }
  private spawn(approach: number, kind: Kind, emergency: boolean) {
    const r = this.rand();
    const turn: Turn = emergency ? "S" : r < 0.62 ? "S" : r < 0.82 ? "L" : "R";
    const spec = SPECS[kind];
    const v: SimVehicle = {
      id: this.nextId++,
      kind,
      color: kind === "bus" ? "#8fd0ee" : kind === "truck" ? "#ffd27a" : kind === "ambulance" ? "#ffffff" : kind === "fire truck" ? "#ff8f84" : CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)],
      approach,
      turn,
      s: 0,
      speed: spec.v * 0.7,
      vmax: spec.v * (0.92 + this.rand() * 0.16),
      len: spec.len,
      x: 0,
      z: 0,
      heading: 0,
      waited: 0,
      emergency,
    };
    this.place(v);
    this.vehicles.push(v);
    this.version++;
    if (emergency) {
      this.events.push({ id: v.id, kind, approach, time: this.time });
      if (this.events.length > 30) this.events.shift();
    }
  }
  private place(v: SimVehicle) {
    const [X, Z, psi] = sampleCanonical(v.turn, v.s);
    const w = toWorld(v.approach, X, Z, psi);
    v.x = w.x;
    v.z = w.z;
    v.heading = w.heading;
  }

  /* ------------------------------- signalling ------------------------------ */
  private beforeStop(v: SimVehicle) {
    return v.s + v.len / 2 < STOP_S + 0.3;
  }
  private updateQueues() {
    this.queue = [0, 0, 0, 0];
    for (const v of this.vehicles) {
      if (!this.beforeStop(v)) continue;
      const toLine = STOP_S - (v.s + v.len / 2);
      if (v.speed < 2 || toLine < 14) this.queue[v.approach]++;
    }
  }
  /** Approach of the closest ambulance that has not crossed the stop line yet, or -1. */
  private emergencyApproach() {
    let best = -1;
    let dist = 36;
    for (const v of this.vehicles) {
      if (!v.emergency || !this.beforeStop(v)) continue;
      const d = STOP_S - (v.s + v.len / 2);
      if (d < dist) {
        dist = d;
        best = v.approach;
      }
    }
    return best;
  }
  private pickNext() {
    const ea = this.emergencyApproach();
    if (ea >= 0) return ea;
    if (!this.settings.adaptive) return (this.lastRoad + 1) % 4;
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < 4; i++) {
      const score = this.queue[i] + 0.2 * (this.time - this.lastGreen[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }
  private updateSignal(dt: number) {
    const sig = this.signal;
    sig.elapsed += dt;
    if (sig.phase === "ALL_RED") {
      sig.remaining = Math.max(0, ALL_RED - sig.elapsed);
      if (sig.elapsed >= ALL_RED) {
        const n = this.pickNext();
        sig.road = n;
        sig.phase = "GREEN";
        sig.elapsed = 0;
        sig.next = null;
        this.lastGreen[n] = this.time;
        this.lastRoad = n;
      }
    } else if (sig.phase === "GREEN") {
      const cur = sig.road as number;
      const q = this.queue;
      const othersWaiting = q.some((n, i) => i !== cur && n > 0);
      const biggestOther = Math.max(...q.filter((_, i) => i !== cur));
      const ea = this.emergencyApproach();
      let end: boolean;
      if (!this.settings.adaptive) {
        end = sig.elapsed >= FIXED_GREEN;
        sig.remaining = Math.max(0, FIXED_GREEN - sig.elapsed);
      } else if (ea >= 0 && ea !== cur) {
        end = sig.elapsed >= 3; // preempt for an ambulance after a short safe minimum
        sig.remaining = Math.max(0, 3 - sig.elapsed);
      } else {
        end =
          sig.elapsed >= MAX_GREEN ||
          (sig.elapsed >= MIN_GREEN && othersWaiting && q[cur] === 0) ||
          (sig.elapsed >= MIN_GREEN && biggestOther > q[cur] * 2 + 3);
        sig.remaining = Math.max(0, (othersWaiting ? MIN_GREEN : MAX_GREEN) - sig.elapsed);
      }
      if (end) {
        sig.phase = "YELLOW";
        sig.elapsed = 0;
        sig.next = this.pickNext();
      }
    } else {
      sig.remaining = Math.max(0, YELLOW - sig.elapsed);
      if (sig.elapsed >= YELLOW) {
        sig.phase = "ALL_RED";
        sig.road = null;
        sig.elapsed = 0;
      }
    }
  }

  /* -------------------------------- movement ------------------------------- */
  private moveVehicles(dt: number) {
    const sig = this.signal;
    const list = this.vehicles;
    for (const v of list) {
      let gap = Infinity;
      let limit = v.vmax;
      // Leader: nearest vehicle ahead in this vehicle's heading, in roughly the same lane.
      const sn = Math.sin(v.heading);
      const cs = Math.cos(v.heading);
      for (const o of list) {
        if (o === v) continue;
        const dx = o.x - v.x;
        const dz = o.z - v.z;
        const fwd = dx * sn + dz * cs;
        if (fwd <= 0 || fwd > 16) continue;
        if (Math.abs(dx * cs - dz * sn) > 1.4) continue;
        if (Math.cos(o.heading - v.heading) < 0.4) continue;
        const g = fwd - (v.len + o.len) / 2 - LEADER_GAP;
        if (g < gap) gap = g;
      }
      // Signal: a red / late-yellow light acts like a stationary obstacle at the stop line.
      if (this.beforeStop(v)) {
        const toLine = STOP_S - (v.s + v.len / 2);
        const mine = sig.road === v.approach;
        const green = mine && sig.phase === "GREEN";
        const brake = (v.speed * v.speed) / (2 * DECEL) + 0.5 * v.speed;
        const commit = mine && sig.phase === "YELLOW" && toLine < brake;
        if (!green && !commit && toLine - 0.25 < gap) gap = toLine - 0.25; // stop just short of the line
      }
      if (gap < Infinity) limit = Math.min(limit, Math.sqrt(Math.max(0, 2 * DECEL * gap)));
      const dv = limit - v.speed;
      v.speed = Math.max(0, v.speed + Math.max(-DECEL * 1.6 * dt, Math.min(ACCEL * dt, dv)));
      v.s += v.speed * dt;
      if (v.speed < 0.3 && this.beforeStop(v)) v.waited += dt;
      this.place(v);
    }
    const before = list.length;
    this.vehicles = list.filter((v) => {
      if (v.s < PATHS[v.turn].total) return true;
      this.completed++;
      this.waits.push(v.waited);
      if (this.waits.length > 40) this.waits.shift();
      return false;
    });
    if (this.vehicles.length !== before) this.version++;
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared instance so the simulation keeps running when you move between pages. */
export const sim = new TrafficSim();

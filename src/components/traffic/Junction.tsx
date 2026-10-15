import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { Film, Moon, Orbit, RefreshCw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROADS, type TrafficState } from "@/lib/traffic";
import { APPROACH_ANGLE, CAR_COLORS, SPAWN, sim, toWorld, type SimVehicle } from "@/lib/sim";
import { useSimStats, useViewMode, type ViewPick } from "@/lib/useSim";
import { VehicleModel } from "./Vehicles3D";
import { Boundary } from "./Boundary";

/* ------------------------------ light palette ------------------------------ */
const P = {
  sky: "#e8f1fc",
  ground: "#d9ecde",
  road: "#b4c0ce",
  plate: "#a9b6c6",
  mark: "#ffffff",
  walk: "#f5efe3",
  lawn: "#d4eed2",
  roof: "#ffffff",
  trunk: "#c3a58c",
  leaf: ["#a6dcae", "#bde8a6", "#9ed6c6"],
  pole: "#8d9cb2",
  head: "#5a667a",
};
const PASTEL = ["#ffd9cc", "#d9e8ff", "#e4dcff", "#fff0c2", "#cdf1e2", "#ffd3e0", "#d5f0f7", "#f1e3d3"];
type V3 = [number, number, number];

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* ------------------------- day / night shared state ------------------------- */
/** 0 = full day, 1 = full night. Eased every frame by <Atmosphere/>; read by lamps, windows and beams. */
const TOD = { v: 0 };
const WINDOW_MATS: THREE.MeshStandardMaterial[] = [];
const AMBER = new THREE.Color("#ffc531");
const RED = new THREE.Color("#ff5a52");
const GREENC = new THREE.Color("#2fd18b");
const DAY_BG = new THREE.Color("#e8f1fc");
const NIGHT_BG = new THREE.Color("#121a33");
const SUN_DAY = new THREE.Color("#fff6e6");
const SUN_NIGHT = new THREE.Color("#8fa6ff");

let TEX: { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null = null;
/** Window pattern drawn once on a canvas: a colour map for daytime and a matching emissive map for night. */
function windowTextures() {
  if (TEX) return TEX;
  const make = (lit: boolean) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = lit ? "#000000" : "#ffffff";
    g.fillRect(0, 0, 128, 128);
    const rnd = mulberry(7);
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) {
        const on = rnd() < 0.55;
        if (lit && !on) continue;
        g.fillStyle = lit ? "#ffd98a" : "#bcd3ea";
        g.fillRect(k * 32 + 7, r * 32 + 8, 18, 16);
      }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return (TEX = { map: make(false), glow: make(true) });
}
let BEAM: { geo: THREE.ConeGeometry; mat: THREE.MeshBasicMaterial } | null = null;
const beam = () =>
  (BEAM ??= {
    geo: new THREE.ConeGeometry(0.8, 3.2, 16, 1, true),
    mat: new THREE.MeshBasicMaterial({ color: "#fff0b8", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  });
function Headlights() {
  const b = beam();
  return <mesh geometry={b.geo} material={b.mat} dispose={null} position={[0, 0.42, 2.9]} rotation-x={-Math.PI / 2} />;
}

const BUILDINGS = (() => {
  const rnd = mulberry(42);
  const grid = [11.5, 18, 24.5, 31, 37.5];
  const out: { x: number; z: number; w: number; h: number; c: string; delay: number }[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const gx of grid)
        for (const gz of grid) {
          if (rnd() < 0.18) continue;
          out.push({
            x: sx * (gx + (rnd() - 0.5) * 1.2),
            z: sz * (gz + (rnd() - 0.5) * 1.2),
            w: 3.6 + rnd() * 1.6,
            h: 3 + rnd() * 9,
            c: PASTEL[Math.floor(rnd() * PASTEL.length)],
            delay: Math.hypot(gx, gz) * 0.03 + rnd() * 0.4,
          });
        }
  return out;
})();

function Box({ position, args, color, cast = false }: { position: V3; args: V3; color: string; cast?: boolean }) {
  return (
    <mesh position={position} castShadow={cast} receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

/** Buildings grow out of the ground when the scene first appears. */
function Building({ b }: { b: (typeof BUILDINGS)[number] }) {
  const g = useRef<THREE.Group>(null);
  const maps = useMemo(() => {
    const t = windowTextures();
    const map = t.map.clone();
    const glow = t.glow.clone();
    for (const m of [map, glow]) {
      m.repeat.set(b.w / 3, b.h / 3);
      m.needsUpdate = true;
    }
    return { map, glow };
  }, [b.w, b.h]);
  useLayoutEffect(() => void g.current?.scale.set(1, 0.001, 1), []);
  useFrame(({ clock }) => {
    if (!g.current || (g.current.scale.y >= 0.999 && clock.elapsedTime > b.delay + 1.4)) return;
    const t = Math.min(1, Math.max(0, (clock.elapsedTime - b.delay) / 1.1));
    const c1 = 1.70158;
    const e = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    g.current.scale.y = Math.max(0.001, e);
  });
  return (
    <group ref={g} position={[b.x, 0.215, b.z]}>
      <mesh position={[0, b.h / 2, 0]} castShadow>
        <boxGeometry args={[b.w, b.h, b.w]} />
        <meshStandardMaterial
          ref={(m) => {
            if (!m) return;
            WINDOW_MATS.push(m);
            return () => void WINDOW_MATS.splice(WINDOW_MATS.indexOf(m), 1);
          }}
          color={b.c}
          map={maps.map}
          emissive="#ffffff"
          emissiveMap={maps.glow}
          emissiveIntensity={TOD.v * 1.5}
          roughness={0.8}
        />
      </mesh>
      <mesh position={[0, b.h + 0.09, 0]}>
        <boxGeometry args={[b.w + 0.25, 0.18, b.w + 0.25]} />
        <meshStandardMaterial color={P.roof} roughness={0.7} />
      </mesh>
    </group>
  );
}

function Tree({ position, scale = 1, tone }: { position: V3; scale?: number; tone: string }) {
  const crown = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (crown.current) crown.current.rotation.z = Math.sin(clock.elapsedTime * 1.1 + position[0] * 0.7 + position[2]) * 0.035;
  });
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.2, 1, 8]} />
        <meshStandardMaterial color={P.trunk} roughness={0.9} />
      </mesh>
      <group ref={crown} position={[0, 1, 0]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <icosahedronGeometry args={[0.95, 1]} />
          <meshStandardMaterial color={tone} roughness={0.85} flatShading />
        </mesh>
      </group>
    </group>
  );
}

function Clouds() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const clouds = useMemo(() => [[-60, 32, -46, 1.2, 1.4], [10, 36, 52, 1.5, 1], [60, 30, -58, 1, 1.8], [-20, 34, 60, 1.3, 1.2], [40, 38, 40, 1.1, 1.5]], []);
  useFrame(({ clock }) => {
    clouds.forEach(([x, , , , speed], i) => {
      const o = refs.current[i];
      if (o) o.position.x = ((((x as number) + clock.elapsedTime * (speed as number) + 100) % 200) + 200) % 200 - 100;
    });
  });
  return (
    <>
      {clouds.map(([x, y, z, s], i) => (
        <group key={i} ref={(el) => void (refs.current[i] = el)} position={[x, y, z]} scale={s}>
          {([[0, 0, 0, 3.2], [3, -0.5, 0.4, 2.5], [-3, -0.6, -0.3, 2.3], [1, 0.9, 0, 2.2]] as [number, number, number, number][]).map(([a, b, c, r], k) => (
            <mesh key={k} position={[a, b, c]}>
              <sphereGeometry args={[r, 14, 10]} />
              <meshStandardMaterial color="#ffffff" transparent opacity={0.78} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

type SignalRead = () => { road: number | null; phase: string };
function lamp(m: THREE.MeshStandardMaterial | null, on: boolean, hex: string) {
  if (!m) return;
  m.color.set(on ? hex : "#6a768b");
  m.emissive.set(hex);
  m.emissiveIntensity = on ? 2.4 : 0;
}

/** Everything that belongs to one approach, built for the North road and rotated into place. */
function Approach({ index, read, heat }: { index: number; read: SignalRead; heat: () => number[] }) {
  const red = useRef<THREE.MeshStandardMaterial>(null);
  const yellow = useRef<THREE.MeshStandardMaterial>(null);
  const green = useRef<THREE.MeshStandardMaterial>(null);
  const stop = useRef<THREE.MeshStandardMaterial>(null);
  // one material per approach, shared by all three lamps on it
  const lampM = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#ffd98a", emissiveIntensity: 0 }), []);
  const poolM = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd98a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const ribbon = useRef<THREE.Mesh>(null);
  const ribbonMat = useRef<THREE.MeshBasicMaterial>(null);
  const level = useRef(0);
  useFrame(({ clock }, dt) => {
    // street lamps and their light pools fade in with the night
    lampM.emissiveIntensity = TOD.v * 2.6;
    poolM.opacity = TOD.v * 0.32;
    // congestion ribbon: grows and shifts green -> amber -> red as the queue builds
    level.current += (Math.min(1, heat()[index] ?? 0) - level.current) * (1 - Math.exp(-dt * 2.5));
    const l = level.current;
    if (ribbon.current && ribbonMat.current) {
      const len = 1.5 + l * 22;
      ribbon.current.scale.z = len;
      ribbon.current.position.z = -6.2 - len / 2;
      const c = ribbonMat.current.color;
      if (l < 0.5) c.copy(GREENC).lerp(AMBER, l * 2);
      else c.copy(AMBER).lerp(RED, (l - 0.5) * 2);
      ribbonMat.current.opacity = l < 0.04 ? 0 : 0.2 + 0.3 * l + 0.05 * Math.sin(clock.elapsedTime * 3.2);
    }
    const s = read();
    const mine = s.road === index;
    const g = mine && s.phase === "GREEN";
    const y = mine && s.phase === "YELLOW";
    lamp(red.current, !g && !y, "#ff5a52");
    lamp(yellow.current, y, "#ffc531");
    lamp(green.current, g, "#2fd18b");
    if (stop.current) {
      const hex = g ? "#2fd18b" : y ? "#ffc531" : "#ff6b63";
      stop.current.color.set(hex);
      stop.current.emissive.set(hex);
      stop.current.emissiveIntensity = g ? 0.7 : y ? 0.5 : 0.28;
    }
  });
  const lamps = useMemo(() => [-13, -25, -37], []);
  const dashes = useMemo(() => Array.from({ length: 14 }, (_, k) => -8.5 - k * 3.6), []);
  const zebra = useMemo(() => Array.from({ length: 8 }, (_, k) => -3.5 + k), []);
  const trees = useMemo(() => [-14, -21, -28, -35, -42, -49], []);
  return (
    <group rotation-y={APPROACH_ANGLE[index]}>
      {dashes.map((z) => <Box key={z} position={[0, 0.09, z]} args={[0.12, 0.012, 1.9]} color={P.mark} />)}
      {[-4.35, 4.35].map((x) => <Box key={x} position={[x, 0.09, -31]} args={[0.1, 0.012, 50]} color={P.mark} />)}
      {zebra.map((x) => <Box key={x} position={[x, 0.09, -4.95]} args={[0.5, 0.012, 1.2]} color={P.mark} />)}
      <mesh position={[2.3, 0.094, -5.75]} receiveShadow>
        <boxGeometry args={[4.2, 0.012, 0.3]} />
        <meshStandardMaterial ref={stop} color="#ff6b63" emissive="#ff6b63" emissiveIntensity={0.28} />
      </mesh>
      {/* signal mast with an arm over the lane */}
      <Box position={[5.7, 2.1, -5.4]} args={[0.2, 4.2, 0.2]} color={P.pole} cast />
      <Box position={[3.85, 4.1, -5.4]} args={[3.7, 0.14, 0.14]} color={P.pole} cast />
      <Box position={[2.25, 3.55, -5.4]} args={[0.52, 1.28, 0.4]} color={P.head} cast />
      {([[0.4, red, "#6a768b"], [0, yellow, "#6a768b"], [-0.4, green, "#6a768b"]] as const).map(([dy, ref, c]) => (
        <mesh key={dy} position={[2.25, 3.55 + dy, -5.63]}>
          <sphereGeometry args={[0.17, 16, 12]} />
          <meshStandardMaterial ref={ref} color={c} roughness={0.4} />
        </mesh>
      ))}
      <mesh ref={ribbon} position={[2.25, 0.105, -8]}>
        <boxGeometry args={[4, 0.01, 1]} />
        <meshBasicMaterial ref={ribbonMat} color="#2fd18b" transparent opacity={0} depthWrite={false} />
      </mesh>
      {lamps.map((z) => (
        <group key={`lamp${z}`}>
          <Box position={[-5.3, 2, z]} args={[0.14, 4, 0.14]} color={P.pole} cast />
          <Box position={[-4.8, 3.95, z]} args={[1.1, 0.1, 0.1]} color={P.pole} />
          <mesh position={[-4.25, 3.86, z]} material={lampM}>
            <boxGeometry args={[0.55, 0.12, 0.26]} />
          </mesh>
          <mesh position={[-3.4, 0.11, z]} rotation-x={-Math.PI / 2} material={poolM}>
            <circleGeometry args={[3.4, 28]} />
          </mesh>
        </group>
      ))}
      {trees.flatMap((z, k) => [
        <Tree key={`a${z}`} position={[6.4, 0.215, z]} scale={0.85 + (k % 3) * 0.12} tone={P.leaf[k % 3]} />,
        <Tree key={`b${z}`} position={[-6.4, 0.215, z - 3]} scale={0.8 + ((k + 1) % 3) * 0.12} tone={P.leaf[(k + 1) % 3]} />,
      ])}
    </group>
  );
}

const World = memo(function World({ read, heat }: { read: SignalRead; heat: () => number[] }) {
  return (
    <>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[260, 0.1, 260]} />
        <meshStandardMaterial color={P.ground} roughness={1} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <Box position={[sx * 32.5, 0.1, sz * 32.5]} args={[56, 0.2, 56]} color={P.walk} />
            <Box position={[sx * 33.6, 0.205, sz * 33.6]} args={[53.6, 0.02, 53.6]} color={P.lawn} />
          </group>
        )),
      )}
      <Box position={[0, 0.04, 0]} args={[9, 0.08, 130]} color={P.road} />
      <Box position={[0, 0.0405, 0]} args={[130, 0.08, 9]} color={P.road} />
      <Box position={[0, 0.075, 0]} args={[9, 0.02, 9]} color={P.plate} />
      {[0, 1, 2, 3].map((i) => <Approach key={i} index={i} read={read} heat={heat} />)}
      {BUILDINGS.map((b, i) => <Building key={i} b={b} />)}
      {([[-7.2, -7.2], [7.2, -7.2], [-7.2, 7.2], [7.2, 7.2]] as [number, number][]).map(([x, z], i) => (
        <Tree key={i} position={[x, 0.215, z]} scale={1.1} tone={P.leaf[i % 3]} />
      ))}
      <Clouds />
    </>
  );
});

/* --------------------------------- vehicles -------------------------------- */
function LiveCar({ tx, tz, th, kind, color }: { tx: number; tz: number; th: number; kind: string; color: string }) {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    g.current?.position.set(tx, 0.215, tz);
    if (g.current) g.current.rotation.y = th;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    const k = 1 - Math.exp(-dt * 5);
    o.position.x += (tx - o.position.x) * k;
    o.position.z += (tz - o.position.z) * k;
    const d = Math.atan2(Math.sin(th - o.rotation.y), Math.cos(th - o.rotation.y));
    o.rotation.y += d * k;
  });
  return <group ref={g}><VehicleModel kind={kind} color={color} /><Headlights /></group>;
}
function LiveVehicles({ state }: { state: TrafficState }) {
  const items = useMemo(
    () =>
      ROADS.flatMap((road, i) =>
        (state.roads[road]?.detections ?? []).slice(0, 18).flatMap((d) => {
          const py = Number(d?.position?.[1]);
          const id = Number(d?.id);
          if (!Number.isFinite(py) || !Number.isFinite(id)) return [];
          const p = Math.max(0.05, Math.min(0.95, py));
          const w = toWorld(i, 1.2 + (id % 2) * 2.1, -(6.4 + (1 - p) * 18), 0);
          if (![w.x, w.z, w.heading].every(Number.isFinite)) return [];
          return [{ key: `${road}-${id}`, id, kind: String(d.class_name || "car").toLowerCase(), x: w.x, z: w.z, h: w.heading }];
        }),
      ),
    [state],
  );
  return <>{items.map((it) => <LiveCar key={it.key} tx={it.x} tz={it.z} th={it.h} kind={it.kind} color={CAR_COLORS[it.id % CAR_COLORS.length]} />)}</>;
}

function SimCar({ v }: { v: SimVehicle }) {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    g.current?.position.set(v.x, 0.215, v.z);
    if (g.current) g.current.rotation.y = v.heading;
  }, [v]);
  useFrame(() => {
    if (!g.current) return;
    g.current.position.set(v.x, 0.215, v.z);
    g.current.rotation.y = v.heading;
  });
  return <group ref={g}><VehicleModel kind={v.kind} color={v.color} /><Headlights /></group>;
}
function SimVehicles() {
  const [list, setList] = useState<SimVehicle[]>(() => [...sim.vehicles]);
  const seen = useRef(-1);
  useFrame((_, dt) => {
    sim.step(dt);
    if (seen.current !== sim.version) {
      seen.current = sim.version;
      setList([...sim.vehicles]);
    }
  });
  return <>{list.map((v) => <SimCar key={v.id} v={v} />)}</>;
}

/* ------------------------- atmosphere & junction FX ------------------------- */
/** Eases the sky, fog, sun and glow materials between day and night. */
function Atmosphere({ night, hemi, sun }: { night: boolean; hemi: RefObject<THREE.HemisphereLight | null>; sun: RefObject<THREE.DirectionalLight | null> }) {
  const { scene } = useThree();
  const bg = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => void (TOD.v = night ? 1 : 0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    TOD.v += ((night ? 1 : 0) - TOD.v) * (1 - Math.exp(-dt * 2.2));
    if (Math.abs((night ? 1 : 0) - TOD.v) < 0.002) TOD.v = night ? 1 : 0;
    const t = TOD.v;
    bg.copy(DAY_BG).lerp(NIGHT_BG, t);
    if (scene.background instanceof THREE.Color) scene.background.copy(bg);
    if (scene.fog) scene.fog.color.copy(bg);
    if (hemi.current) hemi.current.intensity = 1.2 - 0.82 * t;
    if (sun.current) {
      sun.current.intensity = 2.1 - 1.8 * t;
      sun.current.color.copy(SUN_DAY).lerp(SUN_NIGHT, t);
    }
    const w = t * 1.5;
    for (const m of WINDOW_MATS) m.emissiveIntensity = w;
    beam().mat.opacity = t * 0.26;
  });
  return null;
}

/** Soft rings radiate from the junction centre in the colour of the active signal. */
function Pulse({ read }: { read: SignalRead }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const sig = read();
    const hex = sig.road !== null && sig.phase === "GREEN" ? GREENC : sig.phase === "YELLOW" ? AMBER : RED;
    [0, 1].forEach((i) => {
      const t = ((clock.elapsedTime / 3.2 + i * 0.5) % 1 + 1) % 1;
      const m = rings.current[i];
      const mat = mats.current[i];
      if (!m || !mat) return;
      m.scale.setScalar(1 + t * 5.5);
      mat.opacity = (1 - t) * 0.5;
      mat.color.copy(hex);
    });
  });
  return (
    <>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(el) => void (rings.current[i] = el)} position={[0, 0.13, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.85, 1, 56]} />
          <meshBasicMaterial ref={(el) => void (mats.current[i] = el)} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

/* ---------------------------------- camera --------------------------------- */
const VIEWS = { Orbit: [30, 24, 30], Top: [0, 58, 0.01], North: [0, 15, -34], East: [34, 15, 0], South: [0, 15, 34], West: [-34, 15, 0], Street: [2.3, 2.7, 25] } as const;
type View = keyof typeof VIEWS;
function Rig({ view }: { view: View }) {
  const { camera, controls } = useThree();
  const target = useMemo(() => new THREE.Vector3(...VIEWS[view]), [view]);
  const frames = useRef(0);
  useLayoutEffect(() => void (frames.current = 110), [view]);
  useFrame((_, dt) => {
    if (frames.current <= 0) return;
    frames.current -= dt * 60;
    camera.position.lerp(target, 1 - Math.exp(-dt * 4.5));
    (controls as unknown as { update?: () => void } | null)?.update?.();
  });
  return null;
}

function Scene({ state, mode, view, spin, night }: { state: TrafficState; mode: "live" | "sim"; view: View; spin: boolean; night: boolean }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const read = useMemo<SignalRead>(
    () => (mode === "sim"
      ? () => sim.signal
      : () => {
          const s = stateRef.current.signal;
          return { road: s.road ? ROADS.indexOf(s.road) : null, phase: s.phase };
        }),
    [mode],
  );
  const heatRef = useRef<number[]>([0, 0, 0, 0]);
  const heat = useMemo(() => () => heatRef.current, []);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    if (mode === "sim") {
      const n = [0, 0, 0, 0];
      for (const v of sim.vehicles) if (v.speed < 1.2 && v.s < SPAWN - 4) n[v.approach]++;
      heatRef.current = n.map((c) => Math.min(1, c / 8));
    } else {
      const lv: Record<string, number> = { LOW: 0.05, MEDIUM: 0.35, HIGH: 0.7, CRITICAL: 1 };
      heatRef.current = ROADS.map((r) => (stateRef.current.roads[r].count ? lv[stateRef.current.roads[r].density] ?? 0 : 0));
    }
  });
  return (
    <>
      <color attach="background" args={[P.sky]} />
      <fog attach="fog" args={[P.sky, 70, 150]} />
      <PerspectiveCamera makeDefault fov={38} near={0.5} far={400} position={VIEWS.Orbit as unknown as V3} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={10} maxDistance={110} maxPolarAngle={Math.PI / 2.05} autoRotate={spin} autoRotateSpeed={0.6} />
      <Rig view={view} />
      <hemisphereLight ref={hemi} args={["#ffffff", "#cfe6d8", 1.2]} />
      <Atmosphere night={night} hemi={hemi} sun={sunRef} />
      <directionalLight ref={sunRef} position={[26, 40, 16]} intensity={2.1} color="#fff6e6" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-48} shadow-camera-right={48} shadow-camera-top={48} shadow-camera-bottom={-48} shadow-camera-near={1} shadow-camera-far={140} shadow-bias={-0.0004} />
      <World read={read} heat={heat} />
      <Pulse read={read} />
      <Sparkles count={70} scale={[56, 9, 56]} position={[0, 5, 0]} size={4} speed={0.35} opacity={0.75} color="#ffe9a8" />
      <Boundary label="Vehicles" fallback={() => null} autoRetryMs={1200}>{mode === "sim" ? <SimVehicles key="sim" /> : <LiveVehicles key="live" state={state} />}</Boundary>
    </>
  );
}

/* ----------------------------------- UI ------------------------------------ */
const PICKS: { id: ViewPick; label: string }[] = [{ id: "auto", label: "Auto" }, { id: "live", label: "Live" }, { id: "sim", label: "Simulation" }];

export function Junction({ state }: { state: TrafficState }) {
  const [view, setView] = useState<View>("Orbit");
  const [spin, setSpin] = useState(true);
  const [night, setNight] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => {
    if (!tour) return;
    const order: View[] = ["Orbit", "North", "Street", "East", "Top", "South", "West"];
    let i = Math.max(0, order.indexOf(view));
    const id = window.setInterval(() => setView(order[++i % order.length]), 5500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);
  const { mode, choice, setChoice } = useViewMode();
  const stats = useSimStats(350);
  const roadName = stats.signal.road === null ? "All red" : ROADS[stats.signal.road];
  return (
    <div className={`junction-wrap ${night ? "is-night" : ""}`}>
      <Boundary
        label="The 3D view"
        autoRetryMs={2500}
        fallback={(err, retry) => (
          <div className="boundary-note boundary-3d" role="status">
            <strong>The 3D view could not draw and is restarting.</strong>
            <span>{err.message}</span>
            <button type="button" onClick={retry}><RefreshCw size={13} /> Retry now</button>
          </div>
        )}
      >
        <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
          <Scene state={state} mode={mode} view={view} spin={spin && view === "Orbit"} night={night} />
        </Canvas>
      </Boundary>
      <div className="camera-presets" aria-label="Camera presets">
        {(Object.keys(VIEWS) as View[]).map((name) => (
          <Button key={name} type="button" size="sm" variant={view === name ? "secondary" : "ghost"} onClick={() => setView(name)} aria-label={`${name} view`}>{name}</Button>
        ))}
        <Button type="button" size="sm" variant={spin ? "secondary" : "ghost"} onClick={() => setSpin(!spin)} aria-label="Toggle auto-rotate" aria-pressed={spin}><Orbit size={13} /></Button>
        <Button type="button" size="sm" variant={tour ? "secondary" : "ghost"} onClick={() => setTour(!tour)} aria-label="Toggle automatic camera tour" aria-pressed={tour}><Film size={13} /></Button>
        <Button type="button" size="sm" variant={night ? "secondary" : "ghost"} onClick={() => setNight(!night)} aria-label={night ? "Switch to day" : "Switch to night"} aria-pressed={night}>{night ? <Sun size={13} /> : <Moon size={13} />}</Button>
      </div>
      <div className="mode-toggle" role="group" aria-label="Traffic source">
        {PICKS.map((p) => (
          <button key={p.id} type="button" className={choice === p.id ? "mode-on" : ""} onClick={() => setChoice(p.id)} aria-pressed={choice === p.id}>{p.label}</button>
        ))}
      </div>
      <span className="junction-caption">{mode === "sim" ? "SIMULATED TRAFFIC · NOT LIVE DATA · DRAG TO ORBIT" : "LIVE DETECTIONS · DRAG TO ORBIT"}</span>
      {mode === "sim" && (
        <div className="sim-chips" aria-live="off">
          <span><i className={`sim-dot ${stats.signal.phase.toLowerCase()}`} />{roadName} · {stats.signal.phase.replace("_", " ")}</span>
          <span>{stats.count} vehicles</span>
          <span>avg wait {stats.avgWait.toFixed(0)}s</span>
        </div>
      )}
    </div>
  );
}

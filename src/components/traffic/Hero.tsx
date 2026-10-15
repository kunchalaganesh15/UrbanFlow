import { type ReactNode, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Sparkles } from "@react-three/drei";
import { ArrowRight, Box as BoxIcon, Video } from "lucide-react";
import * as THREE from "three";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VehicleModel } from "./Vehicles3D";
import { Boundary } from "./Boundary";

const RING = 4.05;
const LOOP = [
  { kind: "car", color: "#ff9aa2", a: 0 },
  { kind: "car", color: "#9cc5ff", a: 0.9 },
  { kind: "bus", color: "#8fd0ee", a: 1.8 },
  { kind: "car", color: "#cdebb4", a: 2.7 },
  { kind: "truck", color: "#ffd27a", a: 3.6 },
  { kind: "motorcycle", color: "#c3b5ff", a: 4.3 },
  { kind: "car", color: "#ffd3a8", a: 5.2 },
];
const TOWERS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 + 0.3;
  return { x: Math.cos(a) * 5.75, z: Math.sin(a) * 5.75, h: 1.2 + ((i * 7) % 5) * 0.55, c: ["#ffd9cc", "#d9e8ff", "#e4dcff", "#fff0c2", "#cdf1e2"][i % 5] };
});

function Orbiters() {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.5;
  });
  return (
    <group ref={g}>
      {LOOP.map((c, i) => (
        <group key={i} rotation-y={c.a}>
          <group position={[RING, 0.3, 0]} rotation-y={Math.PI}>
            <VehicleModel kind={c.kind} color={c.color} />
          </group>
        </group>
      ))}
    </group>
  );
}
function Beacon() {
  const group = useRef<THREE.Group>(null);
  // One shared material per lamp so all four faces of the tower light together.
  const lamps = useMemo(
    () => (["#ff5a52", "#ffc531", "#2fd18b"] as const).map((hex) => ({ hex, mat: new THREE.MeshStandardMaterial({ color: "#6a768b", emissive: hex, emissiveIntensity: 0, roughness: 0.4 }) })),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const lit = [0, 2, 1][Math.floor(t / 1.6) % 3]; // red -> green -> yellow
    lamps.forEach(({ hex, mat }, i) => {
      mat.color.set(i === lit ? hex : "#6a768b");
      mat.emissiveIntensity = i === lit ? 2.2 : 0;
    });
    if (group.current) {
      group.current.position.y = 1.6 + Math.sin(t * 1.6) * 0.12;
      group.current.rotation.y = t * 0.8;
    }
  });
  return (
    <group ref={group} position={[0, 1.6, 0]}>
      <mesh><boxGeometry args={[0.7, 1.9, 0.7]} /><meshStandardMaterial color="#5a667a" roughness={0.6} /></mesh>
      {[0.6, 0, -0.6].map((y, i) =>
        [0, 1, 2, 3].map((side) => (
          <mesh key={`${i}-${side}`} position={[Math.sin((side * Math.PI) / 2) * 0.36, y, Math.cos((side * Math.PI) / 2) * 0.36]} material={lamps[i].mat}>
            <sphereGeometry args={[0.2, 14, 10]} />
          </mesh>
        )),
      )}
    </group>
  );
}
/** Three staggered radar rings sweeping outward from the beacon. */
function Radar() {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    [0, 1, 2].forEach((i) => {
      const t = ((clock.elapsedTime / 4 + i / 3) % 1 + 1) % 1;
      rings.current[i]?.scale.setScalar(0.25 + t * 1.45);
      if (mats.current[i]) mats.current[i]!.opacity = Math.sin(Math.PI * t) * 0.55 * (1 - t * 0.4);
    });
  });
  return (
    <>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => void (rings.current[i] = el)} position={[0, 0.22, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[3.9, 4, 80]} />
          <meshBasicMaterial ref={(el) => void (mats.current[i] = el)} color="#36b6d8" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}
/** Rising data pillars around the model city that breathe at different rates. */
function Pillars() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return { x: Math.cos(a) * 6.4, z: Math.sin(a) * 6.4, f: 0.8 + (i % 5) * 0.3, p: i * 0.7 }; }), []);
  useFrame(({ clock }) => {
    items.forEach((it, i) => {
      const m = refs.current[i];
      if (!m) return;
      const h = 0.35 + (Math.sin(clock.elapsedTime * it.f + it.p) * 0.5 + 0.5) * 1.1;
      m.scale.y = h;
      m.position.y = 0.17 + h / 2;
    });
  });
  return (
    <>
      {items.map((it, i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} position={[it.x, 0.5, it.z]}>
          <cylinderGeometry args={[0.07, 0.07, 1, 10]} />
          <meshStandardMaterial color="#5fc9e6" emissive="#2fb4da" emissiveIntensity={0.7} roughness={0.4} />
        </mesh>
      ))}
    </>
  );
}
function HeroScene() {
  const towers = useMemo(() => TOWERS, []);
  return (
    <>
      <PerspectiveCamera makeDefault fov={34} position={[10.5, 8.2, 10.5]} />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={1.1} minPolarAngle={0.7} maxPolarAngle={1.25} />
      <hemisphereLight args={["#ffffff", "#d3e6f5", 1.5]} />
      <directionalLight position={[8, 12, 6]} intensity={1.8} color="#fff6e6" />
      <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[6.6, 6.8, 0.5, 64]} /><meshStandardMaterial color="#ffffff" roughness={0.8} /></mesh>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[6.3, 6.3, 0.06, 64]} /><meshStandardMaterial color="#d9efe0" roughness={1} /></mesh>
      <mesh position={[0, 0.17, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[3.3, 4.8, 80]} /><meshStandardMaterial color="#b8c4d3" roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.18, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[4.03, 4.07, 80]} /><meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[3, 3, 0.1, 48]} /><meshStandardMaterial color="#c8ecd0" roughness={1} /></mesh>
      {towers.map((t, i) => (
        <mesh key={i} position={[t.x, 0.15 + t.h / 2, t.z]}><boxGeometry args={[0.9, t.h, 0.9]} /><meshStandardMaterial color={t.c} roughness={0.8} /></mesh>
      ))}
      <Beacon />
      <Orbiters />
      <Radar />
      <Pillars />
      <Sparkles count={60} scale={[13, 6, 13]} position={[0, 3, 0]} size={3.5} speed={0.35} opacity={0.8} color="#7fd6ee" />
    </>
  );
}

export function Hero({ eyebrow, title, subtitle, badge }: { eyebrow: string; title: string; subtitle: string; badge: ReactNode }) {
  return (
    <section className="hero" aria-label="Overview">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <div className="hero-actions">
          <Link to="/analysis" className={cn(buttonVariants({ size: "lg" }), "hero-btn")}><Video size={16} /> Analyse video <ArrowRight size={15} /></Link>
          <Link to="/digital-twin" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "hero-btn")}><BoxIcon size={16} /> Open 3D twin</Link>
          <span className="hero-badge">{badge}</span>
        </div>
      </div>
      <div className="hero-stage" aria-hidden="true">
        <Boundary label="The 3D hero" fallback={() => null} autoRetryMs={3000}><Canvas dpr={[1, 1.4]} gl={{ antialias: true, alpha: true }}><HeroScene /></Canvas></Boundary>
      </div>
    </section>
  );
}

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { MeshStandardMaterial } from "three";

type V3 = [number, number, number];
const GLASS = "#d9eefb";
const TYRE = "#4b5668";

function Block({ p, a, c, glow, intensity = 1 }: { p: V3; a: V3; c: string; glow?: string; intensity?: number }) {
  return (
    <mesh position={p} castShadow>
      <boxGeometry args={a} />
      <meshStandardMaterial color={c} roughness={0.65} emissive={glow ?? "#000000"} emissiveIntensity={glow ? intensity : 0} />
    </mesh>
  );
}
function Wheel({ x, z, r = 0.24 }: { x: number; z: number; r?: number }) {
  return (
    <mesh position={[x, r, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[r, r, 0.16, 14]} />
      <meshStandardMaterial color={TYRE} roughness={0.9} />
    </mesh>
  );
}
function Lamps({ w, len, y }: { w: number; len: number; y: number }) {
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Block p={[s * w * 0.32, y, len / 2 + 0.01]} a={[0.2, 0.12, 0.05]} c="#fff7d6" glow="#ffe9a0" intensity={1.4} />
          <Block p={[s * w * 0.32, y, -len / 2 - 0.01]} a={[0.2, 0.1, 0.05]} c="#ff9a9a" glow="#ff4d4d" intensity={0.8} />
        </group>
      ))}
    </>
  );
}
function Beacon({ y, len }: { y: number; len: number }) {
  const red = useRef<MeshStandardMaterial>(null);
  const blue = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const on = Math.floor(clock.elapsedTime * 5) % 2 === 0;
    if (red.current) red.current.emissiveIntensity = on ? 2.4 : 0.15;
    if (blue.current) blue.current.emissiveIntensity = on ? 0.15 : 2.4;
  });
  return (
    <group position={[0, y, len * 0.12]}>
      <mesh position={[-0.28, 0, 0]}>
        <boxGeometry args={[0.3, 0.14, 0.24]} />
        <meshStandardMaterial ref={red} color="#ff5a5a" emissive="#ff1f1f" />
      </mesh>
      <mesh position={[0.28, 0, 0]}>
        <boxGeometry args={[0.3, 0.14, 0.24]} />
        <meshStandardMaterial ref={blue} color="#5aa7ff" emissive="#1f6bff" />
      </mesh>
    </group>
  );
}

/** A pastel low-poly vehicle. +Z is the front. */
export function VehicleModel({ kind, color }: { kind: string; color: string }) {
  const k = kind.toLowerCase();
  if (k === "motorcycle" || k === "bicycle") {
    const len = 1.05;
    return (
      <group>
        <Block p={[0, 0.5, 0]} a={[0.28, 0.32, len * 0.8]} c={color} />
        <Wheel x={0} z={len * 0.36} r={0.25} />
        <Wheel x={0} z={-len * 0.36} r={0.25} />
        <mesh position={[0, 1.0, -0.05]} castShadow>
          <sphereGeometry args={[0.2, 12, 10]} />
          <meshStandardMaterial color="#ffd9c2" roughness={0.8} />
        </mesh>
        <Block p={[0, 0.78, -0.05]} a={[0.3, 0.38, 0.28]} c="#8fa6c9" />
        <Block p={[0, 0.58, len / 2]} a={[0.14, 0.1, 0.05]} c="#fff7d6" glow="#ffe9a0" intensity={1.4} />
      </group>
    );
  }
  if (k === "bus") {
    const len = 3.5;
    return (
      <group>
        <Block p={[0, 0.85, 0]} a={[1.2, 1.2, len]} c={color} />
        <Block p={[0, 1.12, 0]} a={[1.22, 0.42, len * 0.88]} c={GLASS} />
        <Block p={[0, 1.5, 0]} a={[1.1, 0.1, len * 0.96]} c="#ffffff" />
        {[-1, 1].map((s) => [-len * 0.32, len * 0.32].map((z) => <Wheel key={`${s}${z}`} x={s * 0.6} z={z} r={0.3} />))}
        <Lamps w={1.2} len={len} y={0.55} />
      </group>
    );
  }
  if (k === "truck" || k === "fire truck") {
    const len = 3.1;
    const fire = k === "fire truck";
    return (
      <group>
        <Block p={[0, 0.8, len / 2 - 0.55]} a={[1.05, 0.95, 1.1]} c={fire ? "#ff8f84" : color} />
        <Block p={[0, 1.05, len / 2 - 0.2]} a={[0.9, 0.38, 0.4]} c={GLASS} />
        <Block p={[0, 1.0, -0.45]} a={[1.15, 1.25, len - 1.3]} c={fire ? "#ffb4ab" : "#f6f8fc"} />
        {[-1, 1].map((s) => [-len * 0.3, len * 0.33].map((z) => <Wheel key={`${s}${z}`} x={s * 0.56} z={z} r={0.28} />))}
        <Lamps w={1.05} len={len} y={0.6} />
        {fire && <Beacon y={1.5} len={len} />}
      </group>
    );
  }
  const len = k === "ambulance" ? 2.3 : 1.9;
  const amb = k === "ambulance";
  return (
    <group>
      {amb ? (
        <>
          <Block p={[0, 0.78, 0]} a={[1.05, 1.0, len]} c="#ffffff" />
          <Block p={[0, 0.82, 0]} a={[1.07, 0.16, len * 0.92]} c="#ff7a7a" />
          <Block p={[0, 1.05, len / 2 - 0.45]} a={[0.9, 0.34, 0.5]} c={GLASS} />
          <Beacon y={1.36} len={len} />
        </>
      ) : (
        <>
          <Block p={[0, 0.46, 0]} a={[0.98, 0.44, len]} c={color} />
          <Block p={[0, 0.84, -len * 0.06]} a={[0.82, 0.36, len * 0.52]} c={GLASS} />
          <Block p={[0, 1.04, -len * 0.06]} a={[0.84, 0.05, len * 0.5]} c={color} />
        </>
      )}
      {[-1, 1].map((s) => [-len * 0.3, len * 0.3].map((z) => <Wheel key={`${s}${z}`} x={s * 0.5} z={z} />))}
      <Lamps w={0.98} len={len} y={0.52} />
    </group>
  );
}

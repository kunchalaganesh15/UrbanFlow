import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const ROADS = ["North", "East", "South", "West"] as const;
export type Road = (typeof ROADS)[number];
export type Detection = { id: number; class_name: string; confidence: number; box: [number, number, number, number]; position: [number, number]; emergency?: boolean; suspected?: boolean };
export type EmergencyAlert = { id: string; road: Road; vehicle: string; track_id: number; frame: number; video_time: number; at: string; has_image: boolean; suspected: boolean };
export type RoadState = { count: number; total_unique: number; density: string; fps: number; frame: number; video_time: number; inference_ms: number; classes: Record<string, number>; detections: Detection[]; uploaded: boolean; filename: string | null; processing: boolean };
export type TrafficState = { status: "READY" | "ANALYZING" | "PAUSED" | "STOPPED" | "ERROR"; roads: Record<Road, RoadState>; signal: { road: Road | null; phase: "RED" | "YELLOW" | "ALL_RED" | "GREEN"; remaining: number; next: Road | null }; emergency_queue: { road: Road; vehicle: string; id: number; status: string }[]; alerts: EmergencyAlert[]; settings: Settings; model: string; error: string | null; updated_at: string | null };
export type Settings = { confidence: number; iou: number; resolution: number; tracker: string; min_green: number; max_green: number; yellow: number; all_red: number; emergency_priority: boolean; density_medium: number; density_high: number; density_critical: number };
/**
 * Engine origin. Uses VITE_TRAFFIC_API_URL when set; otherwise the same host the page was opened on
 * (so 127.0.0.1 and localhost both work) with the engine's default port 8000.
 */
export const API: string = import.meta.env["VITE_TRAFFIC_API_URL"] || (typeof window !== "undefined" ? `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname}:8000` : "http://localhost:8000");
/** Turns browser/network errors into something a person can act on. */
export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return "The analysis engine took too long to answer. If this is the first run it may still be downloading the YOLO model; wait a minute and try again.";
  if (error instanceof TypeError) return `Cannot reach the analysis engine at ${API}. Start it from the backend folder with: uvicorn app:app --host 127.0.0.1 --port 8000`;
  return error instanceof Error && error.message ? error.message : fallback;
}
async function call(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { window.clearTimeout(timer); }
}
const emptyRoad = (): RoadState => ({ count: 0, total_unique: 0, density: "LOW", fps: 0, frame: 0, video_time: 0, inference_ms: 0, classes: {}, detections: [], uploaded: false, filename: null, processing: false });
export const INITIAL: TrafficState = { status: "READY", roads: { North: emptyRoad(), East: emptyRoad(), South: emptyRoad(), West: emptyRoad() }, signal: { road: null, phase: "ALL_RED", remaining: 0, next: null }, emergency_queue: [], alerts: [], settings: { confidence: .4, iou: .5, resolution: 640, tracker: "bytetrack.yaml", min_green: 10, max_green: 60, yellow: 3, all_red: 2, emergency_priority: true, density_medium: 11, density_high: 21, density_critical: 36 }, model: "yolo11n.pt", error: null, updated_at: null };
/** Fills in anything the engine omitted so a partial payload can never crash the UI. */
function normalize(raw: Partial<TrafficState>): TrafficState {
  const roads = {} as Record<Road, RoadState>;
  for (const r of ROADS) {
    const src = (raw.roads?.[r] ?? {}) as Partial<RoadState>;
    const detections = Array.isArray(src.detections) ? src.detections.filter((d) => d && Array.isArray(d.position) && d.position.length >= 2 && Number.isFinite(d.position[1]) && typeof d.class_name === "string") : [];
    roads[r] = { ...emptyRoad(), ...src, detections, classes: src.classes ?? {} };
  }
  return { ...INITIAL, ...raw, roads, signal: raw.signal ?? INITIAL.signal, emergency_queue: raw.emergency_queue ?? [], alerts: raw.alerts ?? [], settings: raw.settings ?? INITIAL.settings } as TrafficState;
}
const Context = createContext<{ state: TrafficState; connected: boolean; busy: boolean; message: string | null; request: (path: string, body?: unknown) => Promise<void>; upload: (road: Road, file: File) => Promise<void>; retry: () => Promise<void>; dismiss: () => void; lastError: string | null } | null>(null);
export function TrafficProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrafficState>(INITIAL);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await call(`${API}/api/traffic/live`, {}, 4000);
      if (!response.ok) throw new Error(`Engine answered with HTTP ${response.status}`);
      setState(normalize(await response.json())); setConnected(true); setLastError(null);
    } catch (error) { setConnected(false); setLastError(friendlyError(error, "Engine unreachable")); }
  }, []);
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 1000); return () => window.clearInterval(timer); }, [refresh]);
  const request = async (path: string, body?: unknown) => {
    setBusy(true); setMessage(null);
    try {
      // Starting can block while the YOLO weights download on the very first run, so allow longer.
      const response = await call(`${API}${path}`, { method: "POST", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }, path.endsWith("/start") ? 180000 : 15000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((d: { msg?: string }) => d.msg).join("; ") : "Request failed");
      await refresh();
    } catch (error) { setMessage(friendlyError(error, "Request failed")); } finally { setBusy(false); }
  };
  const upload = async (road: Road, file: File) => {
    setBusy(true); setMessage(null);
    try {
      const form = new FormData(); form.append("road", road); form.append("file", file);
      const response = await call(`${API}/api/video/upload`, { method: "POST", body: form }, 10 * 60000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed");
      await refresh();
    } catch (error) { setMessage(friendlyError(error, "Upload failed")); } finally { setBusy(false); }
  };
  const retry = async () => { setMessage(null); await refresh(); };
  const dismiss = () => setMessage(null);
  return <Context.Provider value={{ state, connected, busy, message, request, upload, retry, dismiss, lastError }}>{children}</Context.Provider>;
}
export function useTraffic() { const value = useContext(Context); if (!value) throw new Error("TrafficProvider missing"); return value; }
export const meta = (title: string, description: string) => ({ meta: [{ title: `${title} | UrbanFlow` }, { name: "description", content: description }, { property: "og:title", content: `${title} | UrbanFlow` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] });

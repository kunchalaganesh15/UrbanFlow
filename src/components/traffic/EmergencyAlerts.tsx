import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Siren, Volume2, VolumeX, X } from "lucide-react";
import { API, ROADS, useTraffic } from "@/lib/traffic";
import { sim } from "@/lib/sim";

type Popup = { key: string; source: "LIVE" | "SIM"; vehicle: string; road: string; detail: string; image?: string; suspected?: boolean };

let audio: AudioContext | null = null;
/** Two-tone siren beep. Browsers only allow sound after a click, so failures are ignored. */
function beep() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
    const t0 = audio.currentTime;
    [880, 660, 880, 660].forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.frequency.value = f;
      o.type = "square";
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
      o.connect(g).connect(audio!.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.22);
    });
  } catch {
    /* sound is optional */
  }
}

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Pop-up alerts for emergency vehicles found in the uploaded videos and in the 3D simulation. */
export function EmergencyAlerts() {
  const { state, connected } = useTraffic();
  const [popups, setPopups] = useState<Popup[]>([]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const simSeen = useRef(-1);

  const push = (p: Popup) => {
    setPopups((list) => [p, ...list.filter((x) => x.key !== p.key)].slice(0, 4));
    if (!mutedRef.current) beep();
  };

  // Real detections from the Python engine
  useEffect(() => {
    if (!connected) return;
    const fresh = state.alerts.filter((a) => !seen.current.has(a.id));
    state.alerts.forEach((a) => seen.current.add(a.id));
    if (!primed.current) {
      primed.current = true;
      // alerts that already existed before this page loaded are listed in the log but not popped up
      return;
    }
    fresh.forEach((a) =>
      push({
        key: `live-${a.id}`,
        source: "LIVE",
        vehicle: a.vehicle,
        road: a.road,
        suspected: a.suspected,
        detail: `Tracked as #${a.track_id} at ${a.video_time}s into the ${a.road} video (frame ${a.frame}).`,
        image: a.has_image ? `${API}/api/alerts/${a.id}/image` : undefined,
      }),
    );
  }, [state.alerts, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simulated emergency vehicles
  useEffect(() => {
    simSeen.current = sim.events.at(-1)?.id ?? -1;
    const timer = window.setInterval(() => {
      const fresh = sim.events.filter((e) => e.id > simSeen.current);
      if (!fresh.length) return;
      simSeen.current = fresh[fresh.length - 1].id;
      fresh.forEach((e) =>
        push({
          key: `sim-${e.id}`,
          source: "SIM",
          vehicle: e.kind,
          road: ROADS[e.approach],
          detail: "Simulated vehicle. The signal will clear its approach (adaptive mode).",
        }),
      );
    }, 400);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-dismiss simulated popups; real alerts stay until closed
  useEffect(() => {
    const sims = popups.filter((p) => p.source === "SIM");
    if (!sims.length) return;
    const timer = window.setTimeout(() => setPopups((l) => l.filter((p) => p.source !== "SIM" || p !== sims[sims.length - 1])), 9000);
    return () => window.clearTimeout(timer);
  }, [popups]);

  return (
    <div className="alert-stack" aria-live="assertive">
      <button type="button" className="alert-sound" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute alert sound" : "Mute alert sound"} title={muted ? "Alert sound off" : "Alert sound on"}>
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      {popups.map((p) => (
        <div key={p.key} className={`alert-card ${p.source === "SIM" ? "alert-sim" : ""}`} role="alert">
          <span className="alert-icon"><Siren size={20} /></span>
          <div className="alert-body">
            <div className="alert-top">
              <strong>{p.source === "SIM" ? "SIMULATED · " : "EMERGENCY · "}{title(p.vehicle)} on {p.road}</strong>
              <button type="button" aria-label="Dismiss alert" onClick={() => setPopups((l) => l.filter((x) => x.key !== p.key))}><X size={14} /></button>
            </div>
            <p>{p.detail}{p.suspected ? " Identified by light-bar / colour analysis, so please verify on the video." : ""}</p>
            {p.image && <img src={p.image} alt={`${p.vehicle} snapshot`} />}
            {p.source === "LIVE" && <Link to="/analysis" className="alert-link">Open video analysis</Link>}
          </div>
        </div>
      ))}
    </div>
  );
}

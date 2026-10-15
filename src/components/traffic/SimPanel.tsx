import { useState } from "react";
import { RotateCcw, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROADS } from "@/lib/traffic";
import { sim } from "@/lib/sim";
import { useSimStats, useViewMode } from "@/lib/useSim";

/** Controls and live numbers for the built-in 3D traffic simulation. */
export function SimPanel() {
  const stats = useSimStats(250);
  const { mode, setChoice } = useViewMode();
  const [, bump] = useState(0);
  const s = sim.settings;
  const set = (patch: Partial<typeof s>) => {
    Object.assign(sim.settings, patch);
    bump((n) => n + 1);
  };
  const maxQueue = Math.max(4, ...stats.queue);
  const roadName = stats.signal.road === null ? "All red" : ROADS[stats.signal.road];
  return (
    <div className="panel sim-panel">
      <div className="section-head">
        <div>
          <h2>Traffic simulation</h2>
          <p>Synthetic cars, buses and motorcycles — not camera data</p>
        </div>
        <span className="panel-tag">{mode === "sim" ? "RUNNING" : "HIDDEN"}</span>
      </div>
      {mode !== "sim" && (
        <p className="sim-note">
          Live detections are on screen. <button type="button" onClick={() => setChoice("sim")}>Show the simulation</button> to drive these controls.
        </p>
      )}
      <div className="settings-fields single sim-fields">
        <label className="setting-field">
          <span>Traffic demand<strong>{Math.round(s.density * 60)} / min per road</strong></span>
          <input type="range" min={0.05} max={0.6} step={0.05} value={s.density} onChange={(e) => set({ density: Number(e.target.value) })} />
          <small>Light to heavy rush hour</small>
        </label>
        <label className="setting-field">
          <span>Playback speed<strong>{s.speed.toFixed(1)}×</strong></span>
          <input type="range" min={0.5} max={2.5} step={0.1} value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
          <small>0.5× to 2.5×</small>
        </label>
        <label className="toggle-field">
          <span><strong>Automatic emergency vehicles</strong><small>An ambulance or fire truck is sent every 20–40 s.</small></span>
          <input type="checkbox" checked={s.autoEmergency} onChange={(e) => set({ autoEmergency: e.target.checked })} />
          <span className="toggle-track" />
        </label>
        <label className="toggle-field">
          <span><strong>Adaptive signal timing</strong><small>Serve the longest queue first. Off = fixed 9 s rotation.</small></span>
          <input type="checkbox" checked={s.adaptive} onChange={(e) => set({ adaptive: e.target.checked })} />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="sim-actions">
        <span className="field-label">DISPATCH AMBULANCE</span>
        <div className="sim-buttons">
          {ROADS.map((road, i) => (
            <Button key={road} size="sm" variant="outline" onClick={() => sim.dispatchAmbulance(i)} aria-label={`Dispatch ambulance on ${road} road`}>
              <Siren size={13} /> {road[0]}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => sim.dispatchAmbulance(Math.floor(Math.random() * 4), "fire truck")} aria-label="Dispatch fire truck on a random road"><Siren size={13} /> Fire truck</Button>
          <Button size="sm" variant="ghost" onClick={() => { sim.reset(); bump((n) => n + 1); }}><RotateCcw size={13} /> Reset</Button>
        </div>
      </div>
      <div className="sim-stats">
        <div className="signal-detail"><span>Signal</span><strong>{roadName} · {stats.signal.phase.replace("_", " ").toLowerCase()} · {stats.signal.remaining}s</strong></div>
        <div className="signal-detail"><span>Vehicles on road</span><strong>{stats.count}{stats.ambulances ? ` (${stats.ambulances} emergency)` : ""}</strong></div>
        <div className="signal-detail"><span>Trips completed</span><strong>{stats.completed}</strong></div>
        <div className="signal-detail"><span>Average wait (last 40)</span><strong>{stats.avgWait.toFixed(1)} s</strong></div>
      </div>
      <div className="class-list sim-queues">
        {ROADS.map((road, i) => (
          <div className="class-row" key={road}>
            <span>{road} queue</span>
            <div className="class-bar"><span style={{ width: `${(stats.queue[i] / maxQueue) * 100}%` }} /></div>
            <strong>{stats.queue[i]}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

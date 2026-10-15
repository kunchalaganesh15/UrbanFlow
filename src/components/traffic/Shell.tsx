import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, ArrowUpRight, BarChart3, CircleHelp, Command, Gauge, Grid2X2, Radio, RefreshCw, Settings2, Video, X } from "lucide-react";
import { type ReactNode } from "react";
import { useTraffic } from "@/lib/traffic";
import { EmergencyAlerts } from "./EmergencyAlerts";
import { PageBoundary } from "./Boundary";

const nav = [ { to: "/", label: "Control center", icon: Grid2X2 }, { to: "/analysis", label: "Video analysis", icon: Video }, { to: "/analytics", label: "Traffic analytics", icon: BarChart3 }, { to: "/digital-twin", label: "Digital twin", icon: Gauge }, { to: "/settings", label: "System settings", icon: Settings2 } ] as const;
const names: Record<string, string> = { "/": "Control center", "/analysis": "Video analysis", "/analytics": "Traffic analytics", "/digital-twin": "Digital twin", "/settings": "System settings" };
export function Shell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: s => s.location.pathname });
  const { state, connected, message, retry, dismiss } = useTraffic();
  return <div className="app-layout">
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark"><Activity size={22} strokeWidth={2.4}/></span><span><strong>urbanflow<span className="brand-dot">.</span></strong><small>TRAFFIC INTELLIGENCE</small></span></Link>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">{nav.map(item => <Link key={item.to} to={item.to} className={`nav-item ${path === item.to ? "nav-active" : ""}`}><item.icon size={18} strokeWidth={1.8}/><span>{item.label}</span>{path === item.to && <span className="nav-marker"/>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-section-label">SYSTEM</div><div className="system-tile"><div className="system-tile-top"><Radio size={16}/><span>{connected ? "ENGINE CONNECTED" : "ENGINE OFFLINE"}</span><span className={`live-dot ${connected ? "online" : ""}`}/></div><p>{connected ? `Processing engine ${state.status.toLowerCase()}` : "Start the local analysis engine to connect live video feeds."}</p></div><div className="sidebar-foot"><CircleHelp size={16}/> UrbanFlow / v1.0</div></div>
    </aside>
    <div className="app-main"><header className="topbar"><div className="breadcrumb"><Command size={16}/><span>Operations</span><span className="slash">/</span><strong>{names[path] || "Workspace"}</strong></div><div className="top-actions"><span className="top-status"><span className={`live-dot ${connected ? "online" : ""}`}/>{connected ? "ENGINE ONLINE" : "ENGINE OFFLINE"}</span><span className="top-divider"/><span className="top-clock">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><span className="avatar">UF</span></div></header>
      {!connected && <div className="engine-banner" role="status"><span className="engine-banner-icon"><Radio size={16}/></span><div><strong>Analysis engine not connected</strong><p>The 3D simulation works without it. For live video detection, run <code>uvicorn app:app --host 127.0.0.1 --port 8000</code> in the <code>backend</code> folder (or double-click <code>start-backend.bat</code>).</p></div><button type="button" onClick={retry}><RefreshCw size={13}/> Retry</button></div>}
      {message && <div role="alert" className="notice"><span>{message}</span><button type="button" aria-label="Dismiss message" onClick={dismiss}><X size={14}/></button></div>}
      <main className="content"><PageBoundary>{children}</PageBoundary></main>
      <footer className="app-footer"><span>URBANFLOW INTELLIGENCE PLATFORM</span><div className="footer-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><span>Research prototype. Not for live signal hardware.</span></div></footer>
    </div>
    <EmergencyAlerts />
  </div>;
}

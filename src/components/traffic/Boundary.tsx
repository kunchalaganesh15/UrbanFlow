import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

type Props = { children: ReactNode; fallback?: (error: Error, retry: () => void) => ReactNode; resetKey?: unknown; label?: string; autoRetryMs?: number };
type S = { error: Error | null; attempts: number };

/**
 * Keeps a rendering failure local. Instead of replacing the whole app with "This page didn't load",
 * only the failing part shows a small notice, retries by itself, and the rest of the site keeps working.
 */
export class Boundary extends Component<Props, S> {
  state: S = { error: null, attempts: 0 };
  private timer: number | undefined;
  static getDerivedStateFromError(error: Error): Partial<S> {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[UrbanFlow] ${this.props.label ?? "section"} failed to render`, error, info.componentStack);
    const ms = this.props.autoRetryMs ?? 2500;
    if (this.state.attempts < 3 && ms > 0) this.timer = window.setTimeout(this.retry, ms);
  }
  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }
  retry = () => {
    window.clearTimeout(this.timer);
    this.setState((s) => ({ error: null, attempts: s.attempts + 1 }));
  };
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return (
      <div className="boundary-note" role="status">
        <strong>{this.props.label ?? "This section"} hit a problem and is recovering.</strong>
        <span>{error.message}</span>
        <button type="button" onClick={this.retry}><RefreshCw size={13} /> Retry now</button>
      </div>
    );
  }
}

/** Wraps a page body so the sidebar, header and alerts stay on screen if one page misbehaves. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <Boundary label="This page" autoRetryMs={2000} resetKey={path}>{children}</Boundary>;
}

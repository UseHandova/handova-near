/**
 * ErrorBoundary — catches render errors so one broken component shows a recoverable message
 * instead of unmounting the whole app (a blank screen).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Compact inline fallback (for a single modal or widget) instead of a full-screen one. */
  inline?: boolean;
  onReset?: () => void;
}

interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Handova] UI error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const box = (
      <div className="max-w-sm w-full rounded-2xl p-6 text-center"
        style={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
        <p className="font-semibold">Something went wrong</p>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          This part of Handova hit an error. Your account and money are safe.
        </p>
        <div className="flex gap-2 justify-center mt-4">
          <button onClick={this.reset} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            Try again
          </button>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--accent)' }}>
            Reload
          </button>
        </div>
      </div>
    );
    return this.props.inline
      ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>{box}</div>
      : <div className="min-h-dvh flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>{box}</div>;
  }
}

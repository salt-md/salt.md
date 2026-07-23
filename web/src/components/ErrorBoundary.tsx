import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// A single render error anywhere below would otherwise unmount the whole SPA to
// a blank white page (StrictMode is NOT an error boundary). This catches it and
// shows a recoverable panel instead.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Salt.md UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>Etwas ist schiefgelaufen</h1>
          <p>Die Ansicht ist auf einen Fehler gestoßen. Deine Daten sind sicher gespeichert.</p>
          <pre className="error-boundary-detail">{this.state.error.message}</pre>
          <div className="error-boundary-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Neu laden
            </button>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Nochmal versuchen
            </button>
          </div>
        </div>
      </div>
    );
  }
}

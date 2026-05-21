import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string | null };

/**
 * Catches render errors; no business logic.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message?.trim() ? error.message : "Unbekannter Fehler",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 text-deep-charcoal">
          <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.14em]">System Error</h1>
          <p className="mt-3 max-w-lg text-center text-sm text-deep-charcoal/50">
            Die Oberfläche ist abgestürzt. Details siehe unten — bitte Seite neu laden oder Support
            informieren.
          </p>
          {this.state.message ? (
            <pre className="mt-6 max-h-[40vh] max-w-2xl overflow-auto rounded-xl border border-deep-charcoal/10 bg-gray-100/80 p-4 text-left font-mono text-xs leading-relaxed text-red-600/90 ">
              {this.state.message}
            </pre>
          ) : null}
          <button
            type="button"
            className="mt-8 min-h-[52px] min-w-[200px] rounded-xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse transition"
            onClick={() => globalThis.location.reload()}
          >
            Neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

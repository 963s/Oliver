import { useUiShellStore } from "../../store/uiShellStore";

export function ToastStack() {
  const toasts = useUiShellStore((s) => s.toasts);
  const removeToast = useUiShellStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[500] flex w-[min(100%-2rem,28rem)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`pointer-events-auto rounded-bento border px-4 py-3 text-left text-sm font-light uppercase tracking-[0.16em] shadow-luxury  ${
            t.variant === "error"
              ? "border-red-400/60 bg-red-50/90 text-red-600/90"
              : t.variant === "success"
                ? "border-editorial-pulse bg-[var(--editorial-pulse-dim)]/55 text-editorial-pulse"
                : "border-brushed-chrome/30 bg-gray-200/95 text-deep-charcoal"
          }`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

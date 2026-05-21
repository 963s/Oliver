import { create } from "zustand";

export type ToastVariant = "info" | "error" | "success";

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type UiShellState = {
  prefersReducedMotion: boolean;
  /** Modal stack ids — higher index = more recent / on top for z-index ordering */
  modalStack: string[];
  toasts: ToastItem[];
  /** Shared layoutId for Framer morph (e.g. appointment card ↔ detail surface) */
  morphLayoutId: string | null;
  /** Appointment card ↔ ClientProfile shared layoutId target */
  morphAppointmentId: number | null;
  /** Paper-slide feedback when print pipeline starts */
  printPaperActive: boolean;
  sidebarOpen: boolean;

  setPrefersReducedMotion: (value: boolean) => void;
  pushModal: (id: string) => void;
  popModal: (id: string) => void;
  clearModalStack: () => void;
  pushToast: (message: string, variant?: ToastVariant, ttlMs?: number) => void;
  removeToast: (id: string) => void;
  setMorphLayoutId: (id: string | null) => void;
  setMorphAppointmentId: (id: number | null) => void;
  triggerPrintPaper: (active: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
};

function newToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random()}`;
}

export const useUiShellStore = create<UiShellState>((set, get) => ({
  prefersReducedMotion:
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  modalStack: [],
  toasts: [],
  morphLayoutId: null,
  morphAppointmentId: null,
  printPaperActive: false,
  sidebarOpen: false,

  setPrefersReducedMotion: (value) => set({ prefersReducedMotion: value }),

  pushModal: (id) =>
    set((s) => ({
      modalStack: s.modalStack.includes(id) ? s.modalStack : [...s.modalStack, id],
    })),

  popModal: (id) =>
    set((s) => ({
      modalStack: s.modalStack.filter((x) => x !== id),
    })),

  clearModalStack: () => set({ modalStack: [] }),

  pushToast: (message, variant = "info", ttlMs = 4500) => {
    const id = newToastId();
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    if (ttlMs > 0 && typeof window !== "undefined") {
      window.setTimeout(() => {
        get().removeToast(id);
      }, ttlMs);
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setMorphLayoutId: (morphLayoutId) => set({ morphLayoutId }),
  setMorphAppointmentId: (morphAppointmentId) => set({ morphAppointmentId }),

  triggerPrintPaper: (printPaperActive) => set({ printPaperActive }),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));

let mediaBound = false;

/** Call once from App mount — reduced motion + optional future global listeners */
export function initUiShellMedia(): void {
  if (mediaBound || typeof window === "undefined") return;
  mediaBound = true;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apply = () => useUiShellStore.getState().setPrefersReducedMotion(mq.matches);
  apply();
  mq.addEventListener("change", apply);
}

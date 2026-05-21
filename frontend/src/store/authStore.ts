import { create } from "zustand";

const LS_DEVICE = "or:deviceToken";
const LS_TOKEN = "or:authToken";
const LS_ROLE = "or:staffRole";

function readPaired(): boolean {
  // Device pairing disabled — salon runs offline, no pairing required.
  // Backend guard is also disabled (see api.ts → registerDeviceGuard commented out).
  return true;
}

function readAuthed(): boolean {
  return Boolean(localStorage.getItem(LS_TOKEN)?.trim());
}

function readStaffRole(): string | null {
  return localStorage.getItem(LS_ROLE);
}

type AuthStore = {
  isPaired: boolean;
  isAuthenticated: boolean;
  isOffline: boolean;
  /** From JWT / PIN login — RBAC for Chef-Ansicht. */
  staffRole: string | null;
  setPaired: (value: boolean) => void;
  setAuthenticated: (value: boolean) => void;
  setOffline: (value: boolean) => void;
  rehydrate: () => void;
  setDeviceToken: (token: string) => void;
  clearDevice: () => void;
  logout: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  isPaired: readPaired(),
  isAuthenticated: readAuthed(),
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
  staffRole: readStaffRole(),

  setPaired: (value) => set({ isPaired: value }),
  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setOffline: (value) => set({ isOffline: value }),

  rehydrate: () =>
    set({
      isPaired: true, // always paired — device pairing disabled
      isAuthenticated: readAuthed(),
      staffRole: readStaffRole(),
    }),

  setDeviceToken: (token) => {
    localStorage.setItem(LS_DEVICE, token);
    set({ isPaired: true });
  },

  clearDevice: () => {
    localStorage.removeItem(LS_DEVICE);
    set({ isPaired: false, isAuthenticated: false });
  },

  logout: () => {
    localStorage.removeItem("or:authToken");
    localStorage.removeItem("or:staffId");
    localStorage.removeItem("or:staffRole");
    localStorage.removeItem("or:staffDisplayName");
    set({ isAuthenticated: false, staffRole: null });
  },
}));

let connectivityBound = false;

export function initAuthConnectivityListeners(): void {
  if (connectivityBound || typeof window === "undefined") return;
  connectivityBound = true;
  const on = () => useAuthStore.getState().setOffline(false);
  const off = () => useAuthStore.getState().setOffline(true);
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  useAuthStore.getState().setOffline(!navigator.onLine);
}

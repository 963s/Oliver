import { create } from "zustand";

type PulseState = {
  globalRefreshCounter: number;
  incrementGlobalRefreshCounter: () => void;
};

/**
 * Bumped when SSE (or similar) indicates data should be refetched. No business logic.
 */
export const usePulseStore = create<PulseState>((set) => ({
  globalRefreshCounter: 0,
  incrementGlobalRefreshCounter: () => set((s) => ({ globalRefreshCounter: s.globalRefreshCounter + 1 })),
}));

import { create } from "zustand";

type FiscalHealthState = {
  /** True if last closed invoice on server was TSE-Ausfall, or if SSE just fired. */
  tseAusfallFromApi: boolean;
  tseAusfallSse: boolean;
  setTseFromApi: (tseAusfallBanner: boolean) => void;
  markTseAusfallSse: () => void;
};

/**
 * TSE-Notstand: API (authoritative) + one-shot SSE hint.
 */
export const useFiscalHealthStore = create<FiscalHealthState>((set) => ({
  tseAusfallFromApi: false,
  tseAusfallSse: false,
  setTseFromApi: (b) => set({ tseAusfallFromApi: b, tseAusfallSse: false }),
  markTseAusfallSse: () => set({ tseAusfallSse: true }),
}));

export function tseBannerVisible(s: Pick<FiscalHealthState, "tseAusfallFromApi" | "tseAusfallSse">): boolean {
  return s.tseAusfallFromApi || s.tseAusfallSse;
}

import { create } from "zustand";

type Client360State = {
  open: boolean;
  clientId: number | null;
  sourceSessionId: number | null;
  openProfile: (clientId: number, opts?: { sourceSessionId?: number | null }) => void;
  closeProfile: () => void;
};

export const useClient360Store = create<Client360State>((set) => ({
  open: false,
  clientId: null,
  sourceSessionId: null,
  openProfile: (clientId, opts) =>
    set({
      open: true,
      clientId,
      sourceSessionId: opts?.sourceSessionId ?? null,
    }),
  closeProfile: () =>
    set({
      open: false,
      clientId: null,
      sourceSessionId: null,
    }),
}));

